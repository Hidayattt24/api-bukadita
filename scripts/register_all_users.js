#!/usr/bin/env node
/**
 * Register All 21 Dummy Users ke Production
 *
 * Script ini akan register semua user dengan pattern:
 * - Phone: Nomor baru (starting from 082234567890)
 * - Password: nama123 (lowercase first name + 123)
 *
 * Usage:
 *   node register_all_users.js
 *
 * Environment:
 *   API_URL - Production API URL (default: https://api-bukadita.vercel.app)
 */

const https = require('https');

const API_URL = process.env.API_URL || 'https://api-bukadita.vercel.app';
const API_ENDPOINT = '/api/v1/auth/register';

// Daftar 21 users dengan phone number baru
const users = [
  // Regular Users (20)
  { phone: '082234567890', full_name: 'Siti Nurhaliza', password: 'siti123' },
  { phone: '082234567891', full_name: 'Ahmad Zainudin', password: 'ahmad123' },
  { phone: '082234567892', full_name: 'Dewi Kartika', password: 'dewi123' },
  { phone: '082234567893', full_name: 'Budi Santoso', password: 'budi123' },
  { phone: '082234567894', full_name: 'Rina Amelia', password: 'rina123' },
  { phone: '082234567895', full_name: 'Muhammad Rizki', password: 'muhammad123' },
  { phone: '082234567896', full_name: 'Ani Wijaya', password: 'ani123' },
  { phone: '082234567897', full_name: 'Hendra Gunawan', password: 'hendra123' },
  { phone: '082234567898', full_name: 'Lina Puspita', password: 'lina123' },
  { phone: '082234567899', full_name: 'Yanto Setiawan', password: 'yanto123' },
  { phone: '082298765431', full_name: 'Fitri Handayani', password: 'fitri123' },
  { phone: '082298765432', full_name: 'Agus Prasetyo', password: 'agus123' },
  { phone: '082298765433', full_name: 'Maya Sari', password: 'maya123' },
  { phone: '082298765434', full_name: 'Doni Pratama', password: 'doni123' },
  { phone: '082298765435', full_name: 'Sri Wahyuni', password: 'sri123' },
  { phone: '082298765436', full_name: 'Eko Nugroho', password: 'eko123' },
  { phone: '082298765437', full_name: 'Putri Ayu', password: 'putri123' },
  { phone: '082298765438', full_name: 'Bambang Susilo', password: 'bambang123' },
  { phone: '082298765439', full_name: 'Wati Susilowati', password: 'wati123' },
  { phone: '082298765440', full_name: 'Rudi Hermawan', password: 'rudi123' },

  // Admin (1)
  { phone: '082299999999', full_name: 'Admin Bukadita', password: 'admin123' },
];

function registerUser(user) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      phone: user.phone,
      password: user.password,
      full_name: user.full_name,
    });

    const url = new URL(API_URL + API_ENDPOINT);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve({
            user,
            status: res.statusCode,
            success: !response.error,
            response,
          });
        } catch (error) {
          resolve({
            user,
            status: res.statusCode,
            success: false,
            error: 'Invalid JSON response',
            rawBody: body,
          });
        }
      });
    });

    req.on('error', (error) => {
      reject({
        user,
        error: error.message,
      });
    });

    req.write(data);
    req.end();
  });
}

async function registerAll() {
  console.log('='.repeat(80));
  console.log('📋 REGISTER ALL USERS TO PRODUCTION');
  console.log('='.repeat(80));
  console.log(`\n🌐 API URL: ${API_URL}${API_ENDPOINT}`);
  console.log(`👥 Total Users: ${users.length}`);
  console.log('\n🚀 Starting registration...\n');

  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  const results = [];

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const num = (i + 1).toString().padStart(2, '0');

    try {
      console.log(`[${num}/${users.length}] Registering: ${user.full_name} (${user.phone})`);

      const result = await registerUser(user);
      results.push(result);

      if (result.success && result.status === 201) {
        console.log(`     ✅ SUCCESS - Registered`);
        successCount++;
      } else if (result.response?.code === 'AUTH_PHONE_ALREADY_EXISTS') {
        console.log(`     ⏭️  SKIP - Already registered`);
        skipCount++;
      } else {
        console.log(`     ❌ FAIL - ${result.response?.message || 'Unknown error'}`);
        failCount++;
      }

      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.log(`     ❌ ERROR - ${error.error || error.message}`);
      failCount++;
    }

    console.log('');
  }

  console.log('='.repeat(80));
  console.log('📊 REGISTRATION SUMMARY');
  console.log('='.repeat(80));
  console.log(`✅ Success:  ${successCount} users registered`);
  console.log(`⏭️  Skipped:  ${skipCount} users (already exist)`);
  console.log(`❌ Failed:   ${failCount} users`);
  console.log(`📋 Total:    ${users.length} users`);
  console.log('='.repeat(80));

  if (successCount > 0 || skipCount > 0) {
    console.log('\n🎉 CREDENTIALS LIST (Save this!):\n');
    console.log('| No | Nama              | Phone        | Password      | Status |');
    console.log('|----|-------------------|--------------|---------------|--------|');

    results.forEach((result, idx) => {
      const status = result.success ? '✅ New' :
                     result.response?.code === 'AUTH_PHONE_ALREADY_EXISTS' ? '⏭️ Exists' : '❌ Failed';
      const num = (idx + 1).toString().padStart(2, ' ');
      const name = result.user.full_name.padEnd(17, ' ');
      const phone = result.user.phone;
      const password = result.user.password.padEnd(13, ' ');

      console.log(`| ${num} | ${name} | ${phone} | ${password} | ${status} |`);
    });

    console.log('\n💡 Pattern Password: [nama_depan_lowercase]123');
    console.log('   Contoh: Siti Nurhaliza → siti123\n');
  }

  if (failCount > 0) {
    console.log('\n⚠️  Some users failed to register. Check errors above.\n');
  } else {
    console.log('\n✅ All users ready! You can now login with any credentials above.\n');
  }
}

// Run
registerAll().catch(console.error);
