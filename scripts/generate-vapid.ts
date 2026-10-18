import webpush from 'web-push';

function generateVapid() {
  const vapidKeys = webpush.generateVAPIDKeys();

  console.log('\n======================================================');
  console.log('🔑 MessMate Web Push (VAPID) Key Generator');
  console.log('======================================================\n');
  console.log('Copy these keys to your .env.local file (do NOT commit secrets to git):\n');
  console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  console.log(`NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
  console.log('VAPID_SUBJECT=mailto:your-email@example.com\n');
  console.log('======================================================\n');
}

generateVapid();
