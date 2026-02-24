#!/usr/bin/env node
/**
 * Genera claves VAPID para Web Push.
 * Añade VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY a .env
 */
const webpush = require('web-push');
const vapid = webpush.generateVAPIDKeys();
console.log('Añade estas variables a .env o Vercel:');
console.log('');
console.log('VAPID_PUBLIC_KEY=' + vapid.publicKey);
console.log('VAPID_PRIVATE_KEY=' + vapid.privateKey);
console.log('');
