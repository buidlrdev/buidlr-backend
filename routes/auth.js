/**
 * Auth routes - user authentication endpoints
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', (req, res) => {
  const { id, email, wallet_address, credits } = req.user;
  
  res.json({
    success: true,
    data: {
      id,
      email,
      walletAddress: wallet_address,
      credits: parseFloat(credits)
    }
  });
});

module.exports = router;
