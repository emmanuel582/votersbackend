import dotenv from 'dotenv';
dotenv.config();

import { supabaseAdmin } from './lib/supabase.js';

async function createBucket() {
  const { data, error } = await supabaseAdmin.storage.createBucket('nominees', {
    public: true,
    fileSizeLimit: 5242880, // 5MB
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  });
  
  if (error) {
    if (error.message.includes('already exists')) {
      console.log('Bucket already exists.');
    } else {
      console.error('Failed to create bucket:', error);
    }
  } else {
    console.log('Bucket created:', data);
  }
}

createBucket();
