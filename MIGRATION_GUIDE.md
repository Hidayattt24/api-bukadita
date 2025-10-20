# Migration Guide: Login dengan Nomor HP

## 📋 Overview

Migration ini mengubah sistem autentikasi dari **email-based** menjadi **phone-based** untuk role `pengguna`. User sekarang dapat login menggunakan nomor HP dan password.

## 🎯 Perubahan Utama

### 1. **Database Schema Changes**

- ✅ Kolom `phone` menjadi **NOT NULL** dan **UNIQUE**
- ✅ Kolom `email` menjadi **nullable** (optional)
- ✅ Kolom `full_name` tetap **required**
- ✅ Index ditambahkan pada kolom `phone` untuk performa
- ✅ Constraint untuk format phone Indonesia

### 2. **Authentication Flow Changes**

#### **Register (Sebelum)**

```json
{
  "email": "user@example.com",
  "password": "password123",
  "full_name": "John Doe",
  "phone": "081234567890" // optional
}
```

#### **Register (Sesudah)**

```json
{
  "phone": "081234567890", // REQUIRED - primary identifier
  "password": "password123",
  "full_name": "John Doe", // REQUIRED
  "email": "user@example.com" // OPTIONAL
}
```

#### **Login (Sebelum)**

```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### **Login (Sesudah)**

```json
{
  "phone": "081234567890", // Phone number sebagai identifier
  "password": "password123"
}
```

## 🔧 Cara Menjalankan Migration

### Step 1: Backup Database (PENTING!)

```sql
-- Backup table profiles
CREATE TABLE profiles_backup_20251020 AS
SELECT * FROM profiles;
```

### Step 2: Jalankan Migration

```bash
# Connect to your Supabase database
psql -U postgres -d your_database

# Run migration file
\i migrations/001_change_login_to_phone.sql
```

Atau melalui Supabase Dashboard:

1. Go to SQL Editor
2. Copy paste isi file `migrations/001_change_login_to_phone.sql`
3. Run the migration

### Step 3: Verifikasi Migration

```sql
-- Check if phone is NOT NULL and UNIQUE
SELECT
  column_name,
  is_nullable,
  data_type
FROM information_schema.columns
WHERE table_name = 'profiles'
  AND column_name IN ('phone', 'email', 'full_name');

-- Check constraints
SELECT
  conname,
  contype,
  pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'profiles'::regclass;

-- Check indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'profiles';

-- Count records
SELECT
  COUNT(*) as total_users,
  COUNT(phone) as users_with_phone,
  COUNT(email) as users_with_email,
  COUNT(DISTINCT phone) as unique_phones
FROM profiles;
```

## 🔄 Rollback Plan

Jika terjadi masalah, gunakan script rollback:

```sql
-- Remove constraints
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_phone_format_check;
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_phone_unique;

-- Make phone nullable again
ALTER TABLE profiles ALTER COLUMN phone DROP NOT NULL;

-- Make email required again
ALTER TABLE profiles ALTER COLUMN email SET NOT NULL;

-- Drop index
DROP INDEX IF EXISTS idx_profiles_phone;

-- Drop function
DROP FUNCTION IF EXISTS generate_dummy_email_from_phone;

-- Restore from backup (if needed)
TRUNCATE profiles;
INSERT INTO profiles SELECT * FROM profiles_backup_20251020;
DROP TABLE profiles_backup_20251020;
```

## 📝 Changes Summary

### Backend Files Changed:

1. **`/migrations/001_change_login_to_phone.sql`** (NEW)

   - Migration SQL untuk perubahan schema

2. **`/src/controllers/auth-controller.js`**
   - ✅ `registerSchema`: Phone required, email optional
   - ✅ `loginSchema`: Phone + password (bukan email)
   - ✅ `register()`: Generate dummy email jika tidak ada
   - ✅ `register()`: Check uniqueness phone
   - ✅ `login()`: Lookup user by phone, then login with email
3. **`/src/controllers/user-controller.js`**
   - ✅ `updateOwnProfileSchema`: Phone required

### API Endpoint Changes:

#### POST `/api/v1/auth/register`

**Request Body:**

```json
{
  "phone": "081234567890", // REQUIRED - Format: 08xxx atau +628xxx
  "password": "password123", // REQUIRED - Min 6 karakter
  "full_name": "John Doe", // REQUIRED - Min 2 karakter
  "email": "user@example.com" // OPTIONAL
}
```

**Response:**

```json
{
  "error": false,
  "code": "AUTH_REGISTER_SUCCESS",
  "message": "Registration successful",
  "data": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_at": 1234567890,
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "profile": {
        "id": "uuid",
        "full_name": "John Doe",
        "phone": "081234567890",
        "email": "user@example.com",
        "role": "pengguna"
      }
    }
  }
}
```

#### POST `/api/v1/auth/login`

**Request Body:**

```json
{
  "phone": "081234567890", // REQUIRED - Format: 08xxx atau +628xxx
  "password": "password123" // REQUIRED
}
```

**Response:**

```json
{
  "error": false,
  "code": "AUTH_LOGIN_SUCCESS",
  "message": "Login successful",
  "data": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_at": 1234567890,
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "phone": "081234567890",
      "last_sign_in_at": "2025-10-20T10:00:00Z",
      "profile": {
        "id": "uuid",
        "full_name": "John Doe",
        "phone": "081234567890",
        "email": "user@example.com",
        "role": "pengguna"
      }
    }
  }
}
```

## 🧪 Testing

### Test Register dengan Phone

```bash
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "081234567890",
    "password": "test123456",
    "full_name": "Test User"
  }'
```

### Test Login dengan Phone

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "081234567890",
    "password": "test123456"
  }'
```

### Test Register dengan Email Optional

```bash
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "081298765432",
    "password": "test123456",
    "full_name": "Test User 2",
    "email": "testuser2@example.com"
  }'
```

## ⚠️ Catatan Penting

1. **Phone Format**

   - Format yang valid: `08123456789` atau `+628123456789`
   - Minimal 10 digit, maksimal 13 digit
   - Harus dimulai dengan `08` atau `+628`

2. **Dummy Email**

   - Jika user tidak memberikan email, sistem akan generate dummy email
   - Format: `{phone}@bukadita.local`
   - Contoh: `081234567890@bukadita.local`

3. **Uniqueness**

   - Setiap phone number hanya bisa digunakan untuk 1 akun
   - Database akan reject jika ada duplikasi phone

4. **Existing Users**

   - Migration akan generate dummy phone untuk user yang belum punya phone
   - Format: `08` + 10 digit random number

5. **Role**
   - Perubahan ini **hanya untuk role `pengguna`**
   - Admin masih bisa menggunakan email jika diperlukan

## 🔒 Security Notes

1. Phone number disimpan dalam format normalized (tanpa spasi)
2. Validation dilakukan di backend untuk format phone Indonesia
3. Constraint database memastikan data integrity
4. RLS policies tetap aktif untuk security

## 📞 Support

Jika ada masalah atau pertanyaan:

1. Check logs di backend: `console.log` di auth-controller.js
2. Verify database dengan query verifikasi di atas
3. Gunakan rollback script jika perlu revert changes

---

**Migration Created:** October 20, 2025  
**Author:** Backend Development Team  
**Version:** 1.0.0
