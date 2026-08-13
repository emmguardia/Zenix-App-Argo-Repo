/**
 * Notification Discord (webhook) — fire and forget.
 * Ne doit jamais faire échouer l'action principale.
 *
 * ⚠ RÈGLE À RESPECTER POUR TOUT NOUVEL APPEL
 *
 * Discord est une société de droit américain : tout ce qui passe par ici QUITTE
 * l'Union européenne. Ces notifications servent uniquement à SIGNALER qu'un
 * événement a eu lieu, jamais à en transporter le contenu.
 *
 * Ne JAMAIS transmettre :
 *   - le contenu d'un message, d'une demande ou d'un document ;
 *   - le nom, le prénom ou l'adresse email d'une personne physique ;
 *   - une adresse, un téléphone, un SIRET, un identifiant de paiement.
 *
 * Ce qu'on s'autorise : le nom de l'organisation cliente — sans lui la
 * notification n'est pas exploitable — et les données strictement techniques
 * (montant prélevé, statut d'abonnement) nécessaires à une réaction immédiate.
 *
 * Le détail se consulte dans l'espace client, qui est le seul endroit où il doit
 * se trouver.
 */
export async function notifyDiscord(title, message) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title,
          description: message,
          color: 0x2563eb,
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (!res.ok) console.error('[discord] HTTP', res.status);
  } catch (e) {
    console.error('[discord] échec envoi:', e.message);
  }
}
