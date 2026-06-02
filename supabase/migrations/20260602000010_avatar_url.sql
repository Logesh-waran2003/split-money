-- Add avatar_url to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;

-- Update existing Google users' avatar_url from auth.users metadata
UPDATE profiles p
SET avatar_url = (
  SELECT raw_user_meta_data->>'avatar_url'
  FROM auth.users u
  WHERE u.id = p.id
    AND raw_user_meta_data->>'avatar_url' IS NOT NULL
);

-- Update the handle_new_user trigger to also capture avatar_url
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url);
  RETURN NEW;
END;
$$;
