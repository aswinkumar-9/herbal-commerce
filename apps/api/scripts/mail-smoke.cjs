// Sends one test email to the local Mailpit inbox.
const nodemailer = require('nodemailer');

const transport = nodemailer.createTransport({
  host: '127.0.0.1',
  port: 1025,
  secure: false,
  ignoreTLS: true,
});

transport
  .sendMail({
    from: 'Herbal Commerce <no-reply@herbal.local>',
    to: 'test.customer1@example.com',
    subject: 'Smoke test',
    text: 'Hello from the Mailpit smoke test.',
  })
  .then((info) => console.log('sent', info.messageId))
  .catch((err) => {
    console.error('failed', err.message);
    process.exit(1);
  });
