const Stripe = require('stripe');

export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).end();
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const { amount } = req.body;
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'huf',
  });
  res.status(200).json({ clientSecret: paymentIntent.client_secret });
}
