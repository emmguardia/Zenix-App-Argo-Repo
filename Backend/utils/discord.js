/**
 * Notification Discord (webhook) — fire and forget.
 * Ne doit jamais faire échouer l'action principale.
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
