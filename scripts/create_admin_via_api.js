/**
 * CREATE ADMIN USER VIA API
 *
 * Script untuk membuat admin user menggunakan backend API
 * Lebih mudah dan aman daripada direct SQL insert
 */

const axios = require('axios');

// Konfigurasi
const API_URL = 'https://api-bukadita.vercel.app/api/v1';
// const API_URL = 'http://localhost:5000/api/v1'; // Uncomment untuk local testing

// Admin user data
const adminUser = {
  phone: '082299999999',
  full_name: 'Admin Bukadita',
  email: 'admin@bukadita.com',
  password: 'admin123',
  role: 'admin'
};

/**
 * Register admin user via API
 */
async function createAdmin() {
  console.log('🚀 Creating admin user...');
  console.log('📋 User data:', {
    phone: adminUser.phone,
    email: adminUser.email,
    name: adminUser.full_name,
    role: adminUser.role
  });

  try {
    // Register user
    const response = await axios.post(`${API_URL}/auth/register`, {
      phone: adminUser.phone,
      email: adminUser.email,
      password: adminUser.password,
      full_name: adminUser.full_name
    });

    console.log('\n✅ Admin user created successfully!');
    console.log('Response:', JSON.stringify(response.data, null, 2));

    // Get user ID from response
    const userId = response.data.data?.user?.id;

    if (userId) {
      console.log('\n📝 User ID:', userId);

      // Update role to admin via Supabase
      console.log('\n🔧 Updating role to admin...');
      console.log('⚠️  IMPORTANT: You need to run this SQL in Supabase:');
      console.log(`
UPDATE public.profiles
SET role = 'admin'
WHERE id = '${userId}';
      `);

      console.log('\n✅ After running the SQL above, you can login with:');
      console.log('   Phone:', adminUser.phone);
      console.log('   Password:', adminUser.password);
    }

  } catch (error) {
    console.error('\n❌ Error creating admin user:');

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));

      if (error.response.status === 400 && error.response.data.message?.includes('already registered')) {
        console.log('\n💡 User already exists! Trying to get user info...');
        await getUserInfo();
      }
    } else if (error.request) {
      console.error('No response received from server');
      console.error('Request:', error.message);
    } else {
      console.error('Error:', error.message);
    }
  }
}

/**
 * Get existing user info
 */
async function getUserInfo() {
  console.log('\n🔍 Getting user info via SQL...');
  console.log('Run this query in Supabase SQL Editor:');
  console.log(`
-- Get user info
SELECT
    u.id,
    u.email,
    u.raw_user_meta_data->>'phone' as phone,
    u.raw_user_meta_data->>'full_name' as full_name,
    p.role,
    u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id
WHERE u.email = 'admin@bukadita.com'
   OR u.raw_user_meta_data->>'phone' = '082299999999';

-- If role is not 'admin', update it:
UPDATE public.profiles
SET role = 'admin'
WHERE phone = '082299999999' OR email = 'admin@bukadita.com';
  `);
}

// Run the script
createAdmin();
