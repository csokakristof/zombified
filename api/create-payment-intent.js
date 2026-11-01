const Stripe = require('stripe');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SHIPPING = { gls: 990, packeta: 690 };
const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const { items, shipping, customer } = req.body || {};

    if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
      return res.status(400).json({ error: 'Üres vagy érvénytelen kosár.' });
    }
    if (typeof shipping !== 'string' || !Object.prototype.hasOwnProperty.call(SHIPPING, shipping)) {
      return res.status(400).json({ error: 'Érvénytelen szállítási mód.' });
    }

    const c = customer || {};
    const name = clean(c.name, 120);
    const email = clean(c.email, 200);
    const phone = clean(c.phone, 40);
    const address = clean(c.address, 200);
    const zip = clean(c.zip, 20);
    const city = clean(c.city, 100);
    const packetaPoint = clean(c.packetaPoint, 200);

    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || phone.length < 6) {
      return res.status(400).json({ error: 'Hiányzó vagy hibás vásárlói adatok.' });
    }
    if (shipping === 'packeta' ? !packetaPoint : (!address || !zip || !city)) {
      return res.status(400).json({ error: 'Hiányzó szállítási cím vagy csomagpont.' });
    }
    const shippingAddress = shipping === 'packeta'
      ? 'Packeta pont: ' + packetaPoint
      : zip + ' ' + city + ', ' + address;

    // Termékek és készlet a szerver adatbázisából
    const { data: products, error: pErr } = await supabase
      .from('products')
      .select('id,name,price_huf,product_variants(size,stock)')
      .eq('is_active', true);
    if (pErr) throw pErr;

    const byName = new Map(products.map((p) => [p.name, p]));
    const wanted = new Map();
    const lines = [];

    for (const it of items) {
      const p = byName.get(clean(it && it.name, 60));
      const size = clean(it && it.size, 5);
      const v = p && p.product_variants.find((x) => x.size === size);
      if (!p || !v) return res.status(400).json({ error: 'Ismeretlen termék vagy méret.' });

      const key = p.id + '|' + size;
      wanted.set(key, (wanted.get(key) || 0) + 1);
      if (wanted.get(key) > v.stock) {
        return res.status(409).json({ error: p.name + ' (' + size + ') sajnos elfogyott vagy nincs elég készlet.' });
      }
      lines.push({ product_id: p.id, product_name: p.name, size, unit_price: p.price_huf });
    }

    const itemsTotal = lines.reduce((s, l) => s + l.unit_price, 0);
    const shippingTotal = SHIPPING[shipping];
    const total = itemsTotal + shippingTotal;

    // Rendelés mentése (egyedi rendelésszám, ütközésnél újrapróbál)
    let order = null;
    for (let attempt = 0; attempt < 5 && !order; attempt++) {
      const { data, error } = await supabase
        .from('orders')
        .insert({
          order_number: 'ZMB-' + crypto.randomInt(100000, 1000000),
          customer_name: name,
          customer_email: email,
          customer_phone: phone,
          shipping_method: shipping,
          shipping_address: shippingAddress,
          items_total: itemsTotal,
          shipping_total: shippingTotal,
          total,
        })
        .select('id,order_number')
        .single();
      if (!error) order = data;
      else if (error.code !== '23505') throw error;
    }
    if (!order) throw new Error('Rendelésszám-generálási hiba');

    const { error: iErr } = await supabase
      .from('order_items')
      .insert(lines.map((l) => ({ ...l, order_id: order.id })));
    if (iErr) throw iErr;

    let pi;
    try {
      pi = await stripe.paymentIntents.create({
        amount: total * 100,
        currency: 'huf',
        metadata: { order_id: order.id, order_number: order.order_number },
      });
    } catch (e) {
      await supabase.from('orders').update({ status: 'failed' }).eq('id', order.id);
      throw e;
    }

    await supabase.from('orders').update({ stripe_payment_intent_id: pi.id }).eq('id', order.id);

    return res.status(200).json({
      clientSecret: pi.client_secret,
      orderNumber: order.order_number,
      total,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Szerverhiba, próbáld újra.' });
  }
};
