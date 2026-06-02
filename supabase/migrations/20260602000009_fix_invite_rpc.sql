-- Fix join_group_via_invite: activity table uses action+meta, not type+description
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

  -- Log activity (use correct columns: action + meta)
  INSERT INTO activity (group_id, user_id, action, meta)
  VALUES (v_invite.group_id, auth.uid(), 'member_joined', '{"description": "Joined via invite link"}'::jsonb);

  RETURN json_build_object('group_id', v_invite.group_id, 'already_member', false);
END;
$$;
