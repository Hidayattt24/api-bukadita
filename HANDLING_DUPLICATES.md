# Handling Duplicate Phone Numbers

## 🔍 Problem

Saat menjalankan migration, ditemukan duplicate phone number di database:

```
ERROR: 23505: could not create unique index "profiles_phone_unique"
DETAIL: Key (phone)=(082283055874) is duplicated.
```

## ✅ Solution

Migration telah diupdate untuk otomatis handle duplicate phone numbers dengan cara:

### 1. **Deteksi Duplicates**

Migration akan scan dan report semua duplicate phone numbers di database.

### 2. **Automatic Fix**

Untuk setiap duplicate phone:

- **Record pertama (oldest)** → Tetap menggunakan phone asli
- **Record kedua dan seterusnya** → Ditambahkan suffix `_2`, `_3`, dst

**Contoh:**

```
Original duplicates:
- User A: 082283055874 (created: 2024-01-01)
- User B: 082283055874 (created: 2024-02-01)
- User C: 082283055874 (created: 2024-03-01)

After migration:
- User A: 082283055874      ✅ (oldest, keep original)
- User B: 082283055874_2    ⚠️ (needs update)
- User C: 082283055874_3    ⚠️ (needs update)
```

## 📋 Post-Migration Actions

### Step 1: Check for Suffixed Phones

Setelah migration berhasil, cek users dengan suffixed phone numbers:

```sql
-- List all users with suffixed phones (duplicates)
SELECT
  id,
  phone,
  email,
  full_name,
  created_at,
  updated_at
FROM profiles
WHERE phone LIKE '%_%'
ORDER BY phone;
```

### Step 2: Contact Users

Users dengan suffixed phone perlu dihubungi untuk:

1. Verifikasi nomor HP yang benar
2. Update ke nomor HP yang valid dan unik

### Step 3: Manual Update

Update phone number untuk user yang sudah terverifikasi:

```sql
-- Update single user
UPDATE profiles
SET phone = '081234567890',  -- New valid phone
    updated_at = NOW()
WHERE id = 'user-uuid-here';

-- Verify no more suffixed phones
SELECT COUNT(*) FROM profiles WHERE phone LIKE '%_%';
```

## 🛠️ Migration Features

Migration yang telah diupdate memiliki fitur:

1. ✅ **Auto-detect duplicates** - Scan semua duplicate phone di awal
2. ✅ **Auto-fix duplicates** - Tambahkan suffix otomatis
3. ✅ **Preserve oldest** - Record tertua tetap punya phone asli
4. ✅ **Generate unique phones** - Untuk NULL phones, generate yang guaranteed unique
5. ✅ **Relaxed constraint** - Phone format constraint allow suffix `_N` selama migration
6. ✅ **Detailed reporting** - Show semua users yang affected

## 📊 Understanding the Fix

### Why Add Suffix?

1. **Migration Success** - Agar migration bisa jalan tanpa error
2. **Data Preservation** - Tidak ada data yang hilang
3. **Clear Identification** - Mudah identify mana yang perlu difix
4. **Oldest Wins** - User pertama (yang paling lama) retain phone asli

### Phone Format After Migration

Valid formats setelah migration:

- `08123456789` - Normal phone ✅
- `+628123456789` - Normal phone with country code ✅
- `082283055874_2` - Suffixed (duplicate, needs fixing) ⚠️
- `082283055874_3` - Suffixed (duplicate, needs fixing) ⚠️

## 🔄 Workflow

```
1. Run Migration
      ↓
2. Migration detects duplicates (e.g., 082283055874)
      ↓
3. Auto-fix: Add suffix to duplicates
      ↓
4. Migration completes successfully
      ↓
5. Check report for suffixed phones
      ↓
6. Contact affected users
      ↓
7. Manually update with correct phone numbers
      ↓
8. Done! All phones are unique and valid
```

## 🔍 Queries untuk Investigation

### Find All Duplicates (Before Migration)

```sql
SELECT
  phone,
  COUNT(*) as count,
  STRING_AGG(id::text, ', ') as user_ids
FROM profiles
WHERE phone IS NOT NULL AND phone != ''
GROUP BY phone
HAVING COUNT(*) > 1
ORDER BY count DESC;
```

### Find Suffixed Phones (After Migration)

```sql
SELECT
  id,
  phone,
  email,
  full_name,
  role,
  created_at
FROM profiles
WHERE phone LIKE '%_%'
ORDER BY phone;
```

### Count Statistics

```sql
SELECT
  COUNT(*) as total_users,
  COUNT(CASE WHEN phone NOT LIKE '%_%' THEN 1 END) as valid_phones,
  COUNT(CASE WHEN phone LIKE '%_%' THEN 1 END) as suffixed_phones
FROM profiles;
```

## ⚠️ Important Notes

1. **Suffixed phones are temporary** - Ini bukan solusi permanen, hanya untuk migration
2. **Users can't login with suffixed phone** - Backend validation akan reject format `phone_N`
3. **Must be fixed manually** - Admin perlu update ke phone yang benar
4. **No automatic cleanup** - Tidak ada auto-cleanup, harus manual

## 🚨 If You See Duplicates

Jika melihat duplicate phone di production:

### Option A: Fix Before Migration (Recommended)

```sql
-- Manual fix before running migration
-- Find duplicates
SELECT phone, COUNT(*) FROM profiles
WHERE phone IS NOT NULL
GROUP BY phone
HAVING COUNT(*) > 1;

-- Update manually based on investigation
UPDATE profiles
SET phone = 'correct-unique-phone'
WHERE id = 'user-id';
```

### Option B: Let Migration Handle It

- Migration akan auto-fix dengan suffix
- Kemudian fix manually setelah migration
- Users dengan suffixed phone tidak bisa login sampai difix

## 📞 Communication Template

Email template untuk users dengan suffixed phone:

```
Subject: Update Required - Phone Number Verification

Dear [User Name],

We're updating our system and noticed that your phone number
needs to be verified and updated.

Current phone: [082283055874_2]
Please update to: [Your correct phone number]

Please contact support or update your profile in the app.

Thank you!
```

## ✅ Verification Checklist

After handling duplicates:

- [ ] Run verification query - no suffixed phones remain
- [ ] Test login with updated phones
- [ ] Verify all users can access their accounts
- [ ] Backup database before any mass updates
- [ ] Document which users were contacted

## 🔧 Rollback (If Needed)

Jika perlu rollback migration karena duplicate issues:

```sql
-- See ROLLBACK section in migration file
-- Or restore from backup:
TRUNCATE profiles;
INSERT INTO profiles SELECT * FROM profiles_backup_20251020;
```

---

**Created:** October 20, 2025  
**Status:** Documented  
**Next Action:** Run updated migration, then handle suffixed phones manually
