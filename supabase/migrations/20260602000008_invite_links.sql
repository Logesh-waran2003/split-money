-- Enable pgcrypto for gen_random_bytes
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Invite tokens table
CREATE TABLE IF NOT EXISTS group_invite_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ DEFAULT NULL,
  max_uses INT DEFAULT NULL,
  use_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE group_invite_links ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read an invite link (to join via it)
CREATE POLICY "anyone can view invite links" ON group_invite_links
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Only group members can create invite links
CREATE POLICY "members can create invite links" ON group_invite_links
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = group_invite_links.group_id
        AND group_members.user_id = auth.uid()
    )
  );

-- Only creator can delete their invite links
CREATE POLICY "creator can delete invite links" ON group_invite_links
  FOR DELETE USING (created_by = auth.uid());

-- Allow incrementing use_count via RPC (use a SECURITY DEFINER function)
CREATE OR REPLACE FUNCTION join_group_via_invite(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invite group_invite_links%ROWTYPE;
  v_already_member BOOLEAN;
BEGIN
  -- Get invite
  SELECT * INTO v_invite FROM group_invite_links WHERE token = p_token;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Invalid invite link');
  END IF;

  -- Check expiry
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RETURN json_build_object('error', 'Invite link has expired');
  END IF;

  -- Check max uses
  IF v_invite.max_uses IS NOT NULL AND v_invite.use_count >= v_invite.max_uses THEN
    RETURN json_build_object('error', 'Invite link has reached its maximum uses');
  END IF;

  -- Check if already a member
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = v_invite.group_id AND user_id = auth.uid()
  ) INTO v_already_member;

  IF v_already_member THEN
    RETURN json_build_object('group_id', v_invite.group_id, 'already_member', true);
  END IF;

  -- Add to group
  INSERT INTO group_members (group_id, user_id)
  VALUES (v_invite.group_id, auth.uid());

  -- Increment use count
  UPDATE group_invite_links SET use_count = use_count + 1 WHERE id = v_invite.id;

  -- Log activity
  INSERT INTO activity (group_id, user_id, type, description)
  VALUES (v_invite.group_id, auth.uid(), 'member_joined', 'Joined via invite link');

  RETURN json_build_object('group_id', v_invite.group_id, 'already_member', false);
END;
$$;
