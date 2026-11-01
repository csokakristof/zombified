const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // 1) Aláírás ellenőrzése
  let event;
  try {
    const raw = await readRaw(req);
    event = stripe.webhooks.constructEvent(
      raw,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('Webhook aláírás hiba:', e.message);
    return res.status(400).send('Bad signature');
  }

  // 2) Idempotencia: ugyanazt az eseményt csak egyszer dolgozzuk fel
  const { error: insErr } = await supabase
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });
  if (insErr) {
    if (insErr.code === '23505') return res.status(200).json({ duplicate: true });
    console.error(insErr);
    return res.status(500).end();
  }

  // 3) Feldolgozás
  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const orderId = pi.metadata && pi.metadata.order_id;

      if (orderId) {
        const { data: order } = await supabase
          .from('orders')
          .select('id,total')
          .eq('id', orderId)
          .maybeSingle();

        if (!order) {
          console.error('Ismeretlen rendelés:', orderId);
        } else if (pi.currency !== 'huf' || pi.amount_received !== order.total * 100) {
          console.error('Összeg eltérés:', order.id, pi.amount_received, order.total * 100);
          await supabase.from('orders').update({ status: 'needs_review' }).eq('id', order.id);
        } else {
          const { data: result, error } = await supabase.rpc('finalize_paid_order', {
            p_order_id: order.id,
          });
          if (error) throw error;
          console.log('Rendelés feldolgozva:', order.id, result);
        }
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const orderId = event.data.object.metadata && event.data.object.metadata.order_id;
      if (orderId) {
        await supabase.from('orders').update({ status: 'failed' }).eq('id', orderId).eq('status', 'pending');
      }
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error(e);
    // hiba esetén töröljük az esemény-jelölést, hogy a Stripe újra próbálhassa
    await supabase.from('stripe_events').delete().eq('id', event.id);
    return res.status(500).end();
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
