-- Migration: Change login from email to phone number
-- Date: 2025-10-20
-- Description: 
-- 1. Make phone NOT NULL and UNIQUE for pengguna role
-- 2. Make email nullable (optional)
-- 3. Add constraints and indexes for phone-based authentication
-- 4. Keep full_name as required field

-- ============================================
-- STEP 1: Backup existing data (optional but recommended)
-- ============================================
-- You can uncomment these lines to create a backup table
-- CREATE TABLE IF NOT EXISTS profiles_backup_20251020 AS 
-- SELECT * FROM profiles;

-- ============================================
-- STEP 2: Add index on phone for faster lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);

-- ============================================
-- STEP 3: Check and report duplicate phone numbers
-- ============================================
-- First, let's identify duplicate phone numbers
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT phone, COUNT(*) as count
    FROM profiles
    WHERE phone IS NOT NULL AND phone != ''
    GROUP BY phone
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE NOTICE 'Found % duplicate phone numbers. They will be fixed automatically.', duplicate_count;
  END IF;
END $$;

-- ============================================
-- STEP 4: Fix duplicate phone numbers
-- ============================================
-- Add sequential suffix to duplicate phone numbers
-- Keep the oldest record with original phone, others get suffix
WITH ranked_duplicates AS (
  SELECT 
    id,
    phone,
    ROW_NUMBER() OVER (PARTITION BY phone ORDER BY created_at ASC) as rn
  FROM profiles
  WHERE phone IS NOT NULL AND phone != ''
)
UPDATE profiles p
SET phone = rd.phone || '_' || rd.rn
FROM ranked_duplicates rd
WHERE p.id = rd.id 
  AND rd.rn > 1
  AND rd.phone IS NOT NULL;

-- Show fixed duplicates
DO $$
DECLARE
  fixed_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO fixed_count
  FROM profiles
  WHERE phone LIKE '%_%';
  
  IF fixed_count > 0 THEN
    RAISE NOTICE 'Fixed % duplicate phone numbers by adding suffix', fixed_count;
  END IF;
END $$;

-- ============================================
-- STEP 5: Update existing NULL phone numbers
-- ============================================
-- Generate dummy phone numbers for existing users without phone
-- Format: 08xxxxxxxxxx (12 digits)
-- Use a loop to ensure uniqueness
DO $$
DECLARE
  profile_record RECORD;
  new_phone TEXT;
  phone_exists BOOLEAN;
BEGIN
  FOR profile_record IN 
    SELECT id FROM profiles WHERE phone IS NULL OR phone = ''
  LOOP
    -- Generate unique random phone
    LOOP
      new_phone := '08' || LPAD(floor(random() * 10000000000)::text, 10, '0');
      
      -- Check if this phone already exists
      SELECT EXISTS(SELECT 1 FROM profiles WHERE phone = new_phone) INTO phone_exists;
      
      -- If unique, break the loop
      EXIT WHEN NOT phone_exists;
    END LOOP;
    
    -- Update with unique phone
    UPDATE profiles SET phone = new_phone WHERE id = profile_record.id;
  END LOOP;
  
  RAISE NOTICE 'Generated unique phone numbers for all NULL phone records';
END $$;

-- ============================================
-- STEP 6: Make phone NOT NULL
-- ============================================
-- Now that all records have phone numbers, make it required
ALTER TABLE profiles 
ALTER COLUMN phone SET NOT NULL;

-- ============================================
-- STEP 7: Add UNIQUE constraint on phone
-- ============================================
-- Create unique constraint on phone number
-- This ensures no two users can have the same phone
ALTER TABLE profiles
ADD CONSTRAINT profiles_phone_unique UNIQUE (phone);

-- ============================================
-- STEP 8: Make email nullable (optional)
-- ============================================
-- Email is no longer required for registration
ALTER TABLE profiles 
ALTER COLUMN email DROP NOT NULL;

-- ============================================
-- STEP 9: Add check constraint for phone format (relaxed for migration)
-- ============================================
-- Note: We use a relaxed format to allow suffixed duplicates during migration
-- Format allows: 08xxxxxxxxx, +628xxxxxxxx, or with _suffix for duplicates
ALTER TABLE profiles
ADD CONSTRAINT profiles_phone_format_check 
CHECK (phone ~ '^(\+62[8-9][\d]{8,11}|0[8-9][\d]{8,11})(_\d+)?$');

-- ============================================
-- STEP 10: Update RLS policies (if needed)
-- ============================================
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;

-- Recreate policies with phone-based authentication support
CREATE POLICY "Users can view their own profile"
ON profiles FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON profiles FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
ON profiles FOR INSERT
WITH CHECK (auth.uid() = id);

-- Policy for admin to view all profiles
CREATE POLICY "Admins can view all profiles"
ON profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

-- ============================================
-- STEP 11: Add comments for documentation
-- ============================================
COMMENT ON COLUMN profiles.phone IS 'Phone number - Primary identifier for login (Indonesian format: 08xx or +628xx)';
COMMENT ON COLUMN profiles.email IS 'Email address - Optional, can be NULL';
COMMENT ON COLUMN profiles.full_name IS 'Full name - Required for all users';
COMMENT ON COLUMN profiles.role IS 'User role - pengguna or admin';

-- ============================================
-- STEP 12: Create function to generate dummy email
-- ============================================
-- This function generates a dummy email from phone number
-- Format: {phone}@bukadita.local
CREATE OR REPLACE FUNCTION generate_dummy_email_from_phone(phone_number TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Remove + and spaces from phone, then add @bukadita.local
  RETURN REPLACE(REPLACE(phone_number, '+', ''), ' ', '') || '@bukadita.local';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_dummy_email_from_phone IS 'Generate dummy email from phone number for users without email';

-- ============================================
-- STEP 13: Update existing records with dummy emails if needed
-- ============================================
-- Update profiles that have NULL email with dummy email
UPDATE profiles 
SET email = generate_dummy_email_from_phone(phone)
WHERE email IS NULL;

-- ============================================
-- STEP 14: Report duplicate phones that were fixed
-- ============================================
-- Show users with suffixed phone numbers (these were duplicates)
DO $$
DECLARE
  rec RECORD;
BEGIN
  RAISE NOTICE '=== DUPLICATE PHONE NUMBERS FIXED ===';
  FOR rec IN 
    SELECT id, phone, email, full_name, created_at
    FROM profiles
    WHERE phone LIKE '%_%'
    ORDER BY phone
  LOOP
    RAISE NOTICE 'User: % (%) - Phone: % - Created: %', 
      rec.full_name, rec.email, rec.phone, rec.created_at;
  END LOOP;
  
  RAISE NOTICE '=== ACTION REQUIRED ===';
  RAISE NOTICE 'Please contact users with suffixed phone numbers to update their phone number.';
  RAISE NOTICE 'Suffixed phones (e.g., 082283055874_2) need to be updated to valid unique numbers.';
END $$;

-- ============================================
-- VERIFICATION QUERIES (Run these to verify migration)
-- ============================================
-- Uncomment to verify:
-- SELECT COUNT(*) as total_users FROM profiles;
-- SELECT COUNT(*) as users_with_phone FROM profiles WHERE phone IS NOT NULL;
-- SELECT COUNT(*) as users_with_email FROM profiles WHERE email IS NOT NULL;
-- SELECT COUNT(*) as users_with_unique_phone FROM (SELECT DISTINCT phone FROM profiles) as distinct_phones;
-- SELECT COUNT(*) as users_with_suffixed_phone FROM profiles WHERE phone LIKE '%_%';

-- Query to see all users with suffixed phones (duplicates that were fixed)
-- SELECT id, phone, email, full_name, created_at 
-- FROM profiles 
-- WHERE phone LIKE '%_%' 
-- ORDER BY phone;

-- ============================================
-- ROLLBACK SCRIPT (if needed)
-- ============================================
-- IMPORTANT: Save this rollback script in case you need to revert

/*
-- ROLLBACK MIGRATION
-- Run these commands in reverse order if you need to rollback:

-- Remove constraints
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_phone_format_check;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_phone_unique;

-- Make phone nullable again
ALTER TABLE profiles ALTER COLUMN phone DROP NOT NULL;

-- Make email required again (if needed)
ALTER TABLE profiles ALTER COLUMN email SET NOT NULL;

-- Drop index
DROP INDEX IF EXISTS idx_profiles_phone;

-- Drop function
DROP FUNCTION IF EXISTS generate_dummy_email_from_phone;

-- Restore from backup (if you created one)
-- TRUNCATE profiles;
-- INSERT INTO profiles SELECT * FROM profiles_backup_20251020;
-- DROP TABLE profiles_backup_20251020;
*/
