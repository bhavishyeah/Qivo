// Augments Express.Request with the raw request body captured by the global
// express.json({ verify }) hook in app.ts. Needed for Razorpay webhook HMAC
// verification, which must run against the exact unparsed bytes.
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

export {};
