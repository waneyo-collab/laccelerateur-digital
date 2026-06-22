// ── Création de compte + email de bienvenue (abonnement) ───────────────────
// Module partagé entre stripe-webhook.js et paddle-webhook.js : à la première
// transaction d'un abonné, on crée son compte Supabase Auth et on lui envoie
// le lien pour créer son mot de passe. Identique pour les deux PSP.

async function generateSetupLink(supabase, email, isNewUser) {
  try {
    // Nouveaux users → 'invite' : lien direct sans redirection serveur
    // Users existants → 'recovery' : seule option disponible
    const type = isNewUser ? 'invite' : 'recovery';
    const { data, error } = await supabase.auth.admin.generateLink({
      type,
      email,
      options: { redirectTo: 'https://app.waneyo-formation.com' }
    });
    if (error) { console.error('❌ generateLink error:', error.message); return null; }
    const actionLink = data?.properties?.action_link;
    if (!actionLink) return null;
    // On ne met jamais le lien Supabase brut dans l'email : les scanners de
    // sécurité (Gmail, Outlook Safe Links, etc.) "pré-cliquent" les liens des
    // emails pour les vérifier, ce qui consomme le token à usage unique avant
    // que l'utilisateur réel ne clique (erreur "otp_expired"). En passant par
    // confirm.html, seul un vrai clic humain déclenche la validation.
    return `https://app.waneyo-formation.com/confirm.html?confirmation_url=${encodeURIComponent(actionLink)}`;
  } catch (err) {
    console.error('❌ Exception generateSetupLink:', err.message);
    return null;
  }
}

async function sendWelcomeEmail(email, firstName, setupLink) {
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
        subject: '🎉 Bienvenue dans L\'Accélérateur Digital — Créez votre mot de passe',
        html: `<!DOCTYPE html>
<html>
<body style="margin:0;padding:32px;background:#0F0A1E;font-family:sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#1a1035;border-radius:16px;padding:32px">
    <div style="font-size:22px;font-weight:800;color:#7C3AED;margin-bottom:16px">Waneyo Formation</div>
    <h2 style="color:#fff;font-size:20px;margin-bottom:16px">Bienvenue ${firstName ? firstName : ''} ! 🎉</h2>
    <p style="color:rgba(255,255,255,0.8);line-height:1.7;margin-bottom:16px">
      Votre abonnement à <strong>L'Accélérateur Digital</strong> est confirmé. Il ne vous reste qu'une étape : créer votre mot de passe pour accéder à votre formation.
    </p>
    <a href="${setupLink}" style="display:inline-block;background:#7C3AED;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:700;font-size:15px;margin-bottom:24px">
      👉 Créer mon mot de passe
    </a>
    <div style="background:rgba(124,58,237,0.15);border-left:4px solid #7C3AED;padding:16px;border-radius:8px;margin-bottom:24px">
      <p style="margin:0;color:rgba(255,255,255,0.9);font-size:14px;line-height:1.6">
        💡 Ce lien expire dans <strong>24h</strong>. Vérifiez vos spams si vous ne voyez pas cet email.
      </p>
    </div>
    <p style="color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:0">
      En cas de question, répondez simplement à cet email.<br/><br/>
      À tout de suite,<br/>
      <strong style="color:#fff">Nadia — Waneyo Formation</strong>
    </p>
  </div>
</body>
</html>`
      })
    });
    if (!res.ok) console.error('❌ Erreur Resend (bienvenue):', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('❌ Exception lors de l\'envoi de l\'email de bienvenue:', err.message);
    return false;
  }
}

// Crée le compte Supabase Auth s'il n'existe pas déjà. Robuste : peu importe
// le message exact renvoyé par Supabase, un échec de création = on suppose
// que le compte existe déjà (cas normal des renouvellements mensuels).
async function ensureAccount(supabase, email, metadata) {
  const { error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: metadata
  });
  if (error) {
    console.error('❌ createUser error (compte probablement déjà existant):', error.message || error);
    return false; // isNewUser = false
  }
  return true; // isNewUser = true
}

module.exports = { generateSetupLink, sendWelcomeEmail, ensureAccount };
