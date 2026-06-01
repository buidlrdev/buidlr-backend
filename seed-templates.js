/**
 * Seed script — run once to populate the templates table
 * Usage: node seed-templates.js
 */

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { query } = require('./db');

const templates = [
  {
    name: 'React Landing Page',
    description: 'Clean, modern landing page with hero, features, testimonials, and CTA sections. Built with React + Vite.',
    category: 'landing',
    techTags: ['React', 'Vite', 'CSS'],
    files: [
      { path: 'package.json', action: 'create', content: '{\n  "name": "landing-page",\n  "private": true,\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build",\n    "preview": "vite preview"\n  },\n  "dependencies": {\n    "react": "^18.3.1",\n    "react-dom": "^18.3.1"\n  },\n  "devDependencies": {\n    "@vitejs/plugin-react": "^4.3.1",\n    "vite": "^5.4.2"\n  }\n}' },
      { path: 'vite.config.js', action: 'create', content: 'import { defineConfig } from \'vite\'\nimport react from \'@vitejs/plugin-react\'\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { allowedHosts: true }\n})' },
      { path: 'index.html', action: 'create', content: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Landing Page</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.jsx"></script>\n</body>\n</html>' },
      { path: 'src/main.jsx', action: 'create', content: 'import React from \'react\'\nimport ReactDOM from \'react-dom/client\'\nimport App from \'./App\'\nimport \'./index.css\'\n\nReactDOM.createRoot(document.getElementById(\'root\')).render(<App />)' },
      { path: 'src/index.css', action: 'create', content: '* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0b; color: #e8e8ed; }\na { color: inherit; text-decoration: none; }' },
      { path: 'src/App.jsx', action: 'create', content: 'import React from \'react\'\n\nexport default function App() {\n  return (\n    <div>\n      <nav style={{ display: \'flex\', justifyContent: \'space-between\', alignItems: \'center\', padding: \'1.5rem 3rem\', borderBottom: \'1px solid #1a1a1f\' }}>\n        <h1 style={{ fontSize: \'1.25rem\', fontWeight: 700 }}>YourApp</h1>\n        <div style={{ display: \'flex\', gap: \'2rem\', alignItems: \'center\' }}>\n          <a href="#features" style={{ color: \'#6b6b76\' }}>Features</a>\n          <a href="#pricing" style={{ color: \'#6b6b76\' }}>Pricing</a>\n          <button style={{ padding: \'0.6rem 1.5rem\', background: \'#00d4aa\', border: \'none\', borderRadius: \'6px\', color: \'#000\', fontWeight: 600, cursor: \'pointer\' }}>Get Started</button>\n        </div>\n      </nav>\n      <header style={{ padding: \'6rem 3rem\', textAlign: \'center\', maxWidth: \'800px\', margin: \'0 auto\' }}>\n        <h2 style={{ fontSize: \'3.5rem\', fontWeight: 800, lineHeight: 1.1, marginBottom: \'1.5rem\' }}>Build Something <span style={{ color: \'#00d4aa\' }}>Amazing</span></h2>\n        <p style={{ fontSize: \'1.25rem\', color: \'#6b6b76\', marginBottom: \'2rem\' }}>The modern platform for building and deploying your next big idea.</p>\n        <button style={{ padding: \'1rem 2.5rem\', background: \'#00d4aa\', border: \'none\', borderRadius: \'8px\', color: \'#000\', fontWeight: 700, fontSize: \'1rem\', cursor: \'pointer\' }}>Start Free Trial</button>\n      </header>\n      <section id="features" style={{ padding: \'4rem 3rem\', maxWidth: \'1000px\', margin: \'0 auto\' }}>\n        <h3 style={{ textAlign: \'center\', fontSize: \'2rem\', marginBottom: \'3rem\' }}>Features</h3>\n        <div style={{ display: \'grid\', gridTemplateColumns: \'repeat(3, 1fr)\', gap: \'2rem\' }}>\n          {[\'Fast\', \'Secure\', \'Scalable\'].map(f => (\n            <div key={f} style={{ background: \'#111113\', padding: \'2rem\', borderRadius: \'12px\', border: \'1px solid #1a1a1f\' }}>\n              <h4 style={{ marginBottom: \'0.75rem\', color: \'#00d4aa\' }}>{f}</h4>\n              <p style={{ color: \'#6b6b76\', fontSize: \'0.9rem\' }}>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>\n            </div>\n          ))}\n        </div>\n      </section>\n    </div>\n  )\n}' }
    ]
  },
  {
    name: 'Web3 dApp Starter',
    description: 'Starter dApp with wallet connection, network switching, and smart contract interaction.',
    category: 'dapp',
    techTags: ['React', 'Vite', 'Web3'],
    files: [
      { path: 'package.json', action: 'create', content: '{\n  "name": "dapp-starter",\n  "private": true,\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  },\n  "dependencies": {\n    "react": "^18.3.1",\n    "react-dom": "^18.3.1"\n  },\n  "devDependencies": {\n    "@vitejs/plugin-react": "^4.3.1",\n    "vite": "^5.4.2"\n  }\n}' },
      { path: 'vite.config.js', action: 'create', content: 'import { defineConfig } from \'vite\'\nimport react from \'@vitejs/plugin-react\'\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { allowedHosts: true }\n})' },
      { path: 'index.html', action: 'create', content: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>dApp</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.jsx"></script>\n</body>\n</html>' },
      { path: 'src/main.jsx', action: 'create', content: 'import React from \'react\'\nimport ReactDOM from \'react-dom/client\'\nimport App from \'./App\'\nimport \'./index.css\'\n\nReactDOM.createRoot(document.getElementById(\'root\')).render(<App />)' },
      { path: 'src/index.css', action: 'create', content: '* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: system-ui, sans-serif; background: #0a0a0b; color: #e8e8ed; }' },
      { path: 'src/App.jsx', action: 'create', content: 'import React, { useState, useEffect } from \'react\'\n\nconst CHAINS = {\n  \'0x1\': { name: \'Ethereum\', symbol: \'ETH\' },\n  \'0x89\': { name: \'Polygon\', symbol: \'MATIC\' },\n  \'0x2105\': { name: \'Base\', symbol: \'ETH\' },\n  \'0xaa36a7\': { name: \'Sepolia\', symbol: \'ETH\' }\n}\n\nexport default function App() {\n  const [account, setAccount] = useState(null)\n  const [chainId, setChainId] = useState(null)\n  const [balance, setBalance] = useState(null)\n\n  const connectWallet = async () => {\n    if (!window.ethereum) return alert(\'Install MetaMask\')\n    const accounts = await window.ethereum.request({ method: \'eth_requestAccounts\' })\n    setAccount(accounts[0])\n    const chain = await window.ethereum.request({ method: \'eth_chainId\' })\n    setChainId(chain)\n    const bal = await window.ethereum.request({ method: \'eth_getBalance\', params: [accounts[0], \'latest\'] })\n    setBalance((parseInt(bal, 16) / 1e18).toFixed(4))\n  }\n\n  useEffect(() => {\n    if (window.ethereum) {\n      window.ethereum.on(\'accountsChanged\', (accs) => setAccount(accs[0] || null))\n      window.ethereum.on(\'chainChanged\', (c) => setChainId(c))\n    }\n  }, [])\n\n  const chain = CHAINS[chainId] || { name: \'Unknown\', symbol: \'?\' }\n\n  return (\n    <div style={{ padding: \'2rem\', maxWidth: \'600px\', margin: \'0 auto\' }}>\n      <h1 style={{ marginBottom: \'2rem\' }}>My dApp</h1>\n      {account ? (\n        <div style={{ background: \'#111113\', padding: \'2rem\', borderRadius: \'12px\', border: \'1px solid #1a1a1f\' }}>\n          <p style={{ marginBottom: \'0.5rem\' }}>Connected: <span style={{ color: \'#00d4aa\' }}>{account.slice(0, 6)}...{account.slice(-4)}</span></p>\n          <p style={{ marginBottom: \'0.5rem\' }}>Network: {chain.name}</p>\n          <p>Balance: {balance} {chain.symbol}</p>\n        </div>\n      ) : (\n        <button onClick={connectWallet} style={{ padding: \'1rem 2rem\', background: \'#00d4aa\', border: \'none\', borderRadius: \'8px\', color: \'#000\', fontWeight: 700, cursor: \'pointer\' }}>Connect Wallet</button>\n      )}\n    </div>\n  )\n}' }
    ]
  },
  {
    name: 'Portfolio Site',
    description: 'Personal portfolio with about, projects showcase, skills, and contact sections.',
    category: 'portfolio',
    techTags: ['React', 'Vite', 'CSS'],
    files: [
      { path: 'package.json', action: 'create', content: '{\n  "name": "portfolio",\n  "private": true,\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  },\n  "dependencies": {\n    "react": "^18.3.1",\n    "react-dom": "^18.3.1"\n  },\n  "devDependencies": {\n    "@vitejs/plugin-react": "^4.3.1",\n    "vite": "^5.4.2"\n  }\n}' },
      { path: 'vite.config.js', action: 'create', content: 'import { defineConfig } from \'vite\'\nimport react from \'@vitejs/plugin-react\'\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { allowedHosts: true }\n})' },
      { path: 'index.html', action: 'create', content: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Portfolio</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.jsx"></script>\n</body>\n</html>' },
      { path: 'src/main.jsx', action: 'create', content: 'import React from \'react\'\nimport ReactDOM from \'react-dom/client\'\nimport App from \'./App\'\nimport \'./index.css\'\n\nReactDOM.createRoot(document.getElementById(\'root\')).render(<App />)' },
      { path: 'src/index.css', action: 'create', content: '* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: system-ui, sans-serif; background: #0a0a0b; color: #e8e8ed; }\na { color: #00d4aa; text-decoration: none; }' },
      { path: 'src/App.jsx', action: 'create', content: 'import React from \'react\'\n\nexport default function App() {\n  return (\n    <div style={{ maxWidth: \'900px\', margin: \'0 auto\', padding: \'2rem\' }}>\n      <nav style={{ display: \'flex\', justifyContent: \'space-between\', padding: \'1rem 0\', borderBottom: \'1px solid #1a1a1f\' }}>\n        <h2>Your Name</h2>\n        <div style={{ display: \'flex\', gap: \'2rem\' }}>\n          <a href="#about">About</a>\n          <a href="#projects">Projects</a>\n          <a href="#contact">Contact</a>\n        </div>\n      </nav>\n      <section id="about" style={{ padding: \'4rem 0\' }}>\n        <h1 style={{ fontSize: \'2.5rem\' }}>Hi, I\'m <span style={{ color: \'#00d4aa\' }}>Your Name</span></h1>\n        <p style={{ color: \'#6b6b76\', fontSize: \'1.25rem\', marginTop: \'1rem\' }}>Full-stack developer passionate about building great products.</p>\n      </section>\n      <section id="projects" style={{ padding: \'4rem 0\' }}>\n        <h3 style={{ fontSize: \'1.5rem\', marginBottom: \'2rem\' }}>Projects</h3>\n        <div style={{ display: \'grid\', gridTemplateColumns: \'repeat(2, 1fr)\', gap: \'1.5rem\' }}>\n          {[\'Project 1\', \'Project 2\', \'Project 3\', \'Project 4\'].map(p => (\n            <div key={p} style={{ background: \'#111113\', padding: \'1.5rem\', borderRadius: \'12px\', border: \'1px solid #1a1a1f\' }}>\n              <h4 style={{ marginBottom: \'0.5rem\' }}>{p}</h4>\n              <p style={{ color: \'#6b6b76\', fontSize: \'0.875rem\' }}>A brief description of this project.</p>\n            </div>\n          ))}\n        </div>\n      </section>\n    </div>\n  )\n}' }
    ]
  },
  {
    name: 'Admin Dashboard',
    description: 'Dashboard with sidebar navigation, stat cards, and data table layout.',
    category: 'dashboard',
    techTags: ['React', 'Vite', 'CSS'],
    files: [
      { path: 'package.json', action: 'create', content: '{\n  "name": "dashboard",\n  "private": true,\n  "version": "1.0.0",\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  },\n  "dependencies": {\n    "react": "^18.3.1",\n    "react-dom": "^18.3.1"\n  },\n  "devDependencies": {\n    "@vitejs/plugin-react": "^4.3.1",\n    "vite": "^5.4.2"\n  }\n}' },
      { path: 'vite.config.js', action: 'create', content: 'import { defineConfig } from \'vite\'\nimport react from \'@vitejs/plugin-react\'\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { allowedHosts: true }\n})' },
      { path: 'index.html', action: 'create', content: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Dashboard</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.jsx"></script>\n</body>\n</html>' },
      { path: 'src/main.jsx', action: 'create', content: 'import React from \'react\'\nimport ReactDOM from \'react-dom/client\'\nimport App from \'./App\'\nimport \'./index.css\'\n\nReactDOM.createRoot(document.getElementById(\'root\')).render(<App />)' },
      { path: 'src/index.css', action: 'create', content: '* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: system-ui, sans-serif; background: #0a0a0b; color: #e8e8ed; }' },
      { path: 'src/App.jsx', action: 'create', content: 'import React from \'react\'\n\nexport default function App() {\n  return (\n    <div style={{ display: \'flex\', minHeight: \'100vh\' }}>\n      <aside style={{ width: \'240px\', background: \'#111113\', padding: \'2rem 1rem\', borderRight: \'1px solid #1a1a1f\' }}>\n        <h2 style={{ marginBottom: \'2rem\', color: \'#00d4aa\', fontSize: \'1.25rem\' }}>Dashboard</h2>\n        <nav style={{ display: \'flex\', flexDirection: \'column\', gap: \'0.25rem\' }}>\n          {[\'Overview\', \'Analytics\', \'Users\', \'Settings\'].map((item, i) => (\n            <a key={item} href="#" style={{ color: i === 0 ? \'#e8e8ed\' : \'#6b6b76\', padding: \'0.75rem 1rem\', borderRadius: \'8px\', background: i === 0 ? \'#1a1a1f\' : \'transparent\', textDecoration: \'none\' }}>{item}</a>\n          ))}\n        </nav>\n      </aside>\n      <main style={{ flex: 1, padding: \'2rem\' }}>\n        <h1 style={{ marginBottom: \'2rem\' }}>Overview</h1>\n        <div style={{ display: \'grid\', gridTemplateColumns: \'repeat(3, 1fr)\', gap: \'1rem\', marginBottom: \'2rem\' }}>\n          {[{label:\'Users\',val:\'12,847\'},{label:\'Revenue\',val:\'$48,290\'},{label:\'Active\',val:\'342\'}].map(s => (\n            <div key={s.label} style={{ background: \'#111113\', padding: \'1.5rem\', borderRadius: \'12px\', border: \'1px solid #1a1a1f\' }}>\n              <p style={{ color: \'#6b6b76\', fontSize: \'0.875rem\', marginBottom: \'0.5rem\' }}>{s.label}</p>\n              <p style={{ fontSize: \'2rem\', fontWeight: 700 }}>{s.val}</p>\n            </div>\n          ))}\n        </div>\n        <div style={{ background: \'#111113\', borderRadius: \'12px\', border: \'1px solid #1a1a1f\', padding: \'1.5rem\' }}>\n          <h3 style={{ marginBottom: \'1rem\' }}>Recent Activity</h3>\n          <p style={{ color: \'#6b6b76\' }}>Your data table goes here.</p>\n        </div>\n      </main>\n    </div>\n  )\n}' }
    ]
  }
];

async function seed() {
  for (const t of templates) {
    const id = uuidv4();
    await query(
      'INSERT INTO templates (id, name, description, category, tech_tags, files) VALUES (?, ?, ?, ?, ?, ?)',
      [id, t.name, t.description, t.category, JSON.stringify(t.techTags), JSON.stringify(t.files)]
    );
    console.log(`✓ Seeded: ${t.name}`);
  }
  console.log('\nDone! All templates seeded.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
