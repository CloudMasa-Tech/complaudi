const jwt = require('jsonwebtoken');
const fs = require('fs');
const env = require('dotenv').config().parsed;
const token = jwt.sign({ sub: 'test-user', org: 'test-org', role: 'owner' }, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
console.log(token);
