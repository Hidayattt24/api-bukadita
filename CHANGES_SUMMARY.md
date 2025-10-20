# Summary Perubahan Backend - Login dengan Nomor HP

## 📌 Ringkasan Perubahan

Sistem autentikasi telah diubah dari **email-based** menjadi **phone-based** untuk role `pengguna`. User sekarang login menggunakan **nomor HP + password** instead of email + password.

## ✅ Files yang Diubah/Dibuat

### 1. **Database Migration**

📁 `migrations/001_change_login_to_phone.sql` (BARU)

- Mengubah kolom `phone` menjadi NOT NULL dan UNIQUE
- Mengubah kolom `email` menjadi nullable
- Menambah index pada kolom phone
- Menambah constraint untuk validasi format phone Indonesia
- Membuat function `generate_dummy_email_from_phone()`
- Update RLS policies

### 2. **Backend Controller - Authentication**

📁 `src/controllers/auth-controller.js`

**Perubahan:**

- ✅ `registerSchema`: Phone required (bukan email), email jadi optional
- ✅ `loginSchema`: Phone + password (bukan email + password)
- ✅ `register()` function:
  - Check uniqueness phone number
  - Generate dummy email jika tidak disediakan: `{phone}@bukadita.local`
  - Normalize phone format
  - Create profile dengan phone sebagai identifier utama
- ✅ `login()` function:
  - Terima phone + password
  - Lookup user by phone di profiles table
  - Ambil email dari profile
  - Login ke Supabase Auth menggunakan email (internal)
  - Return data dengan phone sebagai identifier

### 3. **Backend Controller - User Profile**

📁 `src/controllers/user-controller.js`

**Perubahan:**

- ✅ `updateOwnProfileSchema`: Phone required, email optional
- Validasi phone format Indonesia tetap konsisten

### 4. **Documentation**

📁 `MIGRATION_GUIDE.md` (BARU)

- Panduan lengkap untuk menjalankan migration
- API documentation dengan contoh request/response
- Testing guide
- Rollback instructions
- Security notes

## 🔄 Perubahan API Contract

### Register Endpoint

**Sebelum:**

```json
POST /api/v1/auth/register
{
  "email": "user@example.com",  // REQUIRED
  "password": "password123",
  "full_name": "John Doe",
  "phone": "081234567890"       // OPTIONAL
}
```

**Sesudah:**

```json
POST /api/v1/auth/register
{
  "phone": "081234567890",      // REQUIRED - Primary identifier
  "password": "password123",     // REQUIRED
  "full_name": "John Doe",      // REQUIRED
  "email": "user@example.com"   // OPTIONAL
}
```

### Login Endpoint

**Sebelum:**

```json
POST /api/v1/auth/login
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Sesudah:**

```json
POST /api/v1/auth/login
{
  "phone": "081234567890",  // Phone number as identifier
  "password": "password123"
}
```

## 🎯 Validasi Format Phone

Format yang valid:

- `08123456789` (10-13 digit)
- `+628123456789` (10-13 digit setelah +62)

Regex pattern: `^(\+62[8-9][\d]{8,11}|0[8-9][\d]{8,11})$`

## 🔍 Cara Kerja Login Flow (Baru)

```
User Input: Phone + Password
       ↓
1. Normalize phone (remove spaces)
       ↓
2. Lookup user by phone in profiles table
       ↓
3. Get email from profile record
       ↓
4. Login to Supabase Auth using email + password
       ↓
5. Return access_token + user data (with phone)
```

## 📊 Database Schema Changes

### Table: `profiles`

| Column    | Before         | After                  | Notes              |
| --------- | -------------- | ---------------------- | ------------------ |
| phone     | text, NULLABLE | text, NOT NULL, UNIQUE | Primary identifier |
| email     | text, NOT NULL | text, NULLABLE         | Optional now       |
| full_name | text, NOT NULL | text, NOT NULL         | No change          |

**New Constraints:**

- `profiles_phone_unique` - Ensures each phone is unique
- `profiles_phone_format_check` - Validates Indonesian phone format
- `idx_profiles_phone` - Index for faster phone lookups

## 🚀 Cara Deploy Perubahan

### Step 1: Backup Database

```sql
CREATE TABLE profiles_backup_20251020 AS SELECT * FROM profiles;
```

### Step 2: Run Migration

```bash
psql -U postgres -d your_db -f migrations/001_change_login_to_phone.sql
```

Atau via Supabase SQL Editor

### Step 3: Deploy Backend Code

```bash
git add .
git commit -m "feat: change login to phone-based authentication"
git push origin main
```

### Step 4: Update Frontend

Frontend perlu diupdate untuk:

- Input phone number instead of email di login form
- Input phone number di register form (required)
- Email jadi optional di register form

### Step 5: Test

```bash
# Test register
curl -X POST http://localhost:4000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone":"081234567890","password":"test123","full_name":"Test User"}'

# Test login
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"081234567890","password":"test123"}'
```

## ⚠️ Breaking Changes

1. **Register endpoint** sekarang **require phone** (bukan email)
2. **Login endpoint** sekarang **require phone** (bukan email)
3. Frontend **HARUS diupdate** untuk support phone-based login
4. Existing users yang **belum punya phone** akan di-generate dummy phone

## 🔐 Security Considerations

1. ✅ Phone number di-normalize sebelum disimpan
2. ✅ Uniqueness enforced di database level
3. ✅ Format validation di backend (Joi) dan database (constraint)
4. ✅ RLS policies tetap aktif
5. ✅ Password tetap di-hash oleh Supabase Auth
6. ✅ JWT tokens tetap aman

## 🐛 Potential Issues & Solutions

### Issue 1: Existing users tanpa phone

**Solution:** Migration akan generate dummy phone untuk existing users

### Issue 2: Duplicate phone numbers ⚠️

**Solution:** Migration akan otomatis add suffix (`_2`, `_3`) pada duplicates.

- User pertama (oldest) tetap pakai phone asli
- Users lainnya dapat suffix dan perlu diupdate manual
- **Action Required:** Contact users dengan suffixed phone untuk update
- **Detail:** Lihat [HANDLING_DUPLICATES.md](./HANDLING_DUPLICATES.md)

**Query untuk cek duplicates:**

```sql
SELECT id, phone, email, full_name, created_at
FROM profiles
WHERE phone LIKE '%_%'
ORDER BY phone;
```

### Issue 3: Invalid phone format

**Solution:** Validation di backend dan database constraint

### Issue 4: User lupa phone number

**Solution:** Implementasi fitur "Find by email" atau recovery mechanism

## 📝 Next Steps (Frontend)

1. Update login form: Email input → Phone input
2. Update register form: Phone required, email optional
3. Update validation rules untuk phone format
4. Update API calls ke backend
5. Test login/register flow
6. Update dokumentasi user-facing

## 🎉 Benefits

1. ✅ Lebih sesuai dengan target user Indonesia (phone-based)
2. ✅ Tidak perlu email untuk registrasi
3. ✅ Lebih mudah bagi user untuk mengingat identifier (phone)
4. ✅ Phone sudah unique di Indonesia
5. ✅ Tetap support email optional untuk future features

## 📞 Contact

Jika ada pertanyaan atau issue, hubungi backend development team.

---

**Migration Date:** October 20, 2025  
**Version:** 2.0.0  
**Status:** ✅ Ready for Testing
