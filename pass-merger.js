(function (root) {
  'use strict';
  const decode = value => value.replace(/&quot;|&#34;/g, '"').replace(/&#039;|&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  function extract(har) {
    if (!Array.isArray(har?.log?.entries)) throw Error('Choose a valid HAR export.');
    const tickets = new Map();
    let skipped = 0;
    for (const entry of har.log.entries) {
      const content = entry.response?.content;
      if (!content?.text) continue;
      let html = content.text;
      if (content.encoding === 'base64') {
        try { html = new TextDecoder().decode(Uint8Array.from(atob(html), c => c.charCodeAt(0))); } catch { continue; }
      }
      for (const match of html.matchAll(/\bdata-event\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        let t;
        try { t = JSON.parse(decode(match[1] ?? match[2])); } catch { skipped++; continue; }
        if (!t || typeof t.qrCode !== 'string' || !t.qrCode.trim() || !t.order_seat_id || !t.team_name || !t.formatted_event_date) { skipped++; continue; }
        const key = String(t.order_seat_id);
        if (tickets.has(key) && tickets.get(key).qrCode !== t.qrCode) throw Error('This HAR contains changing barcode values for the same ticket. Capture a fresh ticket page.');
        tickets.set(key, t);
      }
    }
    if (!tickets.size) throw Error('No supported ticket records found. Use a FansFirst Tickets HAR with the ticket page response included.');
    if (tickets.size > 50) throw Error('Please generate no more than 50 tickets at a time.');
    if ([...tickets.values()].some(t => t.show_qr_rotation === true || t.show_qr_rotation === 1 || t.show_qr_rotation === '1')) throw Error('This HAR uses rotating barcodes, which cannot be preserved as static passes.');
    return { tickets: [...tickets.values()], skipped };
  }
  async function generate(templateBytes, tickets, JSZip, progress = () => {}) {
    const original = await JSZip.loadAsync(templateBytes);
    if (!original.file('pass.json')) throw Error('The template must be a single .pkpass containing pass.json.');
    const template = JSON.parse(await original.file('pass.json').async('string'));
    const assets = [];
    for (const [name, entry] of Object.entries(original.files)) {
      if (/^(icon|logo|strip|background|thumbnail|footer)(@\dx)?\.(png|jpg|jpeg)$/i.test(name) && !entry.dir) assets.push([name, await entry.async('uint8array')]);
    }
    const bundle = new JSZip();
    const field = (key, label, value) => ({ key, label, value: String(value ?? '') });
    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];
      const ref = t.level_type === 'nonseating';
      const pass = {
        formatVersion: 1, serialNumber: 'viewer-' + t.order_seat_id,
        description: String(t.team_name), organizationName: template.organizationName || 'Tickets',
        backgroundColor: template.backgroundColor || 'rgb(13,93,185)', foregroundColor: template.foregroundColor || 'rgb(255,255,255)', labelColor: template.labelColor || 'rgb(255,255,255)',
        eventTicket: {
          headerFields: [field('date', '', t.formatted_event_date)], primaryFields: [],
          secondaryFields: [field('event', t.venue_name || 'EVENT', t.team_name)],
          auxiliaryFields: [field('section', 'SECTION', t.section_name), field('row', ref ? 'ROW REF.' : 'ROW', t.row_name), field('seat', ref ? 'SEAT REF.' : 'SEAT', t.seat_name)],
          backFields: [field('venue', 'VENUE', t.venue_name), field('timezone', 'TIMEZONE', t.timezone), field('order', 'ORDER', t.order_id), field('ticket', 'TICKET', t.order_seat_id), field('seating', 'SEATING', ref ? 'Non-assigned seating; row and seat are source-record references.' : t.level_type), field('source', 'SOURCE', 'Local viewer copy from HAR ticket data and template artwork.')]
        },
        barcodes: [{ format: 'PKBarcodeFormatQR', message: t.qrCode, messageEncoding: 'utf-8', altText: t.qrCode }],
        userInfo: { viewerOnly: true, unsigned: true, qrDisplayDisabledInSource: Boolean(Number(t.disable_qr_code)) }
      };
      const zip = new JSZip();
      zip.file('pass.json', JSON.stringify(pass, null, 2));
      for (const [name, bytes] of assets) zip.file(name, bytes);
      const filename = 'ticket-' + String(t.order_seat_id).replace(/[^a-zA-Z0-9_-]/g, '_') + '.pkpass';
      bundle.file(filename, await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
      progress(i + 1, tickets.length);
    }
    bundle.file('README.txt', 'Viewer-only .pkpass files. Extract this ZIP and select the passes in PKPass Viewer. Artwork comes from the template; ticket details and exact barcode payloads come from the HAR. These files are unsigned. Original signatures, credentials, and HAR request headers are not included.\n');
    return bundle.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }
  root.PassMerger = { extract, generate };
  if (typeof module !== 'undefined') module.exports = root.PassMerger;
})(globalThis);
