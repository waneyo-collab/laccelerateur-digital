// ── Livraison du Guide Marketing (achat unique) ─────────────────────────────
// Module partagé entre stripe-webhook.js et paddle-webhook.js : génère un lien
// de téléchargement signé (privé, expirant) et l'envoie par email via Resend.
// Le PDF n'est JAMAIS public : il vit dans un bucket Supabase Storage privé.

const GUIDE_BUCKET   = 'guides';
const GUIDE_FILENAME = 'guide-marketing-entrepreneur.pdf';
const LINK_EXPIRY_SECONDS = 60 * 60 * 48; // 48h

async function sendGuideEmail(supabase, email, firstName) {
  const { data: signed, error: signError } = await supabase
    .storage
    .from(GUIDE_BUCKET)
    .createSignedUrl(GUIDE_FILENAME, LINK_EXPIRY_SECONDS);

  if (signError || !signed?.signedUrl) {
    console.error('❌ Erreur génération lien signé guide:', signError?.message);
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Nadia — Waneyo Formation <contact@waneyo-formation.com>',
        to: email,
        subject: '📊 Ton Guide Marketing est prêt à télécharger !',
        html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:32px;background:#0F0A1E;font-family:sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#1a1035;border-radius:16px;padding:32px">
    <div style="font-size:22px;font-weight:800;color:#7C3AED;margin-bottom:16px">Waneyo Formation</div>
    <h2 style="color:#fff;font-size:20px;margin-bottom:16px">Merci ${firstName ? firstName : ''} pour ton achat ! 🎉</h2>
    <p style="color:rgba(255,255,255,0.8);line-height:1.7;margin-bottom:16px">
      Ton <strong>Guide Marketing pour Entrepreneur Indépendant</strong> est prêt. Clique ci-dessous pour le télécharger.
    </p>
    <a href="${signed.signedUrl}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px;margin-bottom:24px">
      📥 Télécharger mon guide
    </a>
    <div style="background:rgba(124,58,237,0.15);border-left:4px solid #7C3AED;padding:16px;border-radius:8px;margin-bottom:24px">
      <p style="margin:0;color:rgba(255,255,255,0.9);font-size:14px;line-height:1.6">
        💡 Ce lien expire dans <strong>48h</strong>. Télécharge et enregistre ton guide dès maintenant.
      </p>
    </div>
    <p style="color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:0">
      En cas de problème, répondez simplement à cet email.<br/><br/>
      Bonne lecture,<br/>
      <strong style="color:#fff">Nadia — Waneyo Formation</strong>
    </p>
  </div>
</body>
</html>`
      })
    });
    if (!res.ok) console.error('❌ Erreur Resend (guide):', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('❌ Exception envoi email guide:', err.message);
    return false;
  }
}

// Log facultatif de la vente (table guide_purchases) — n'échoue jamais le flux
// si la table n'existe pas encore ou si l'insert échoue.
async function logGuidePurchase(supabase, { email, psp, amount }) {
  try {
    await supabase.from('guide_purchases').insert({ email, psp, amount });
  } catch (err) {
    console.error('⚠️ Log guide_purchases ignoré:', err.message);
  }
}

module.exports = { sendGuideEmail, logGuidePurchase, GUIDE_BUCKET, GUIDE_FILENAME };
