// Vercel function: GET /api/health -> what this host can do (the booth's setup screen and importer ask this).
// db: false - the question-set library lives on the Mac (server.py); on Vercel the browser keeps the sets.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true, envKey: !!process.env.NVIDIA_API_KEY, db: false, host: 'vercel' });
};
