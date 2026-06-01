/**
 * Container Manager - orchestrates container lifecycle for sessions
 * Handles: create container → write files → install deps → start dev server
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs').promises;
const dockerService = require('./docker');
const nginxService = require('./nginx');
const { query } = require('../db');
const config = require('../config');

// Base directory for session project files on the host
const PROJECTS_DIR = '/var/www/buidlr/projects';
const STATIC_DIR = '/var/www/buidlr/static';

/**
 * Ensure a container is running for a session, write files, install deps, start dev server.
 * Returns container info with port.
 */
async function setupSessionContainer(sessionId, fileChanges) {
  // 1. Create project directory on host
  const projectDir = path.join(PROJECTS_DIR, sessionId);
  await fs.mkdir(projectDir, { recursive: true });

  // 2. Write all files to project directory
  for (const file of fileChanges) {
    if (file.action === 'delete') {
      try {
        await fs.unlink(path.join(projectDir, file.path));
      } catch (err) {
        // File might not exist
      }
      continue;
    }

    const filePath = path.join(projectDir, file.path);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf8');
  }

  // 3. Detect project type and determine start command
  const projectInfo = await detectProjectType(projectDir);

  // 4. Ensure required files exist (AI sometimes forgets index.html)
  await ensureRequiredFiles(projectDir, projectInfo);

  // 5. Create/start container with project mounted
  const containerInfo = await createProjectContainer(sessionId, projectDir, projectInfo);

  // 6. Update session DB with container info
  await query(
    "UPDATE sessions SET container_id = ?, container_port = ?, container_status = 'running' WHERE id = ?",
    [containerInfo.id, containerInfo.port, sessionId]
  );

  // 7. Setup Nginx reverse proxy for preview subdomain
  await setupNginxPreview(sessionId, containerInfo.port);

  return containerInfo;
}

/**
 * Update files in an existing container's project and restart if needed
 */
async function updateSessionFiles(sessionId, fileChanges) {
  const projectDir = path.join(PROJECTS_DIR, sessionId);

  // Write updated files
  for (const file of fileChanges) {
    if (file.action === 'delete') {
      try {
        await fs.unlink(path.join(projectDir, file.path));
      } catch (err) {}
      continue;
    }

    const filePath = path.join(projectDir, file.path);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf8');
  }

  // Re-detect project type and ensure required files
  const projectInfo = await detectProjectType(projectDir);
  await ensureRequiredFiles(projectDir, projectInfo);

  // Check if package.json was updated (needs npm install)
  const packageJsonChanged = fileChanges.some(f => f.path === 'package.json');

  // Get current container info
  const sessions = await query(
    'SELECT container_id, container_port FROM sessions WHERE id = ?',
    [sessionId]
  );

  if (sessions.length > 0 && sessions[0].container_id) {
    const containerId = sessions[0].container_id;

    try {
      if (packageJsonChanged) {
        // Run npm install inside the container
        await execInContainer(containerId, 'cd /app && npm install');
      }
      // Vite/React dev servers auto-reload on file changes since the volume is mounted
      // No need to restart the container
    } catch (err) {
      console.error('Failed to update container:', err.message);
    }

    return {
      id: containerId,
      port: sessions[0].container_port,
      status: 'running'
    };
  }

  // No container yet — do full setup
  return setupSessionContainer(sessionId, fileChanges);
}

/**
 * Detect project type from files
 */
async function detectProjectType(projectDir) {
  let packageJson = null;
  try {
    const raw = await fs.readFile(path.join(projectDir, 'package.json'), 'utf8');
    packageJson = JSON.parse(raw);
  } catch (err) {
    // No package.json
  }

  if (packageJson) {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (deps['vite'] || deps['@vitejs/plugin-react']) {
      return {
        type: 'vite',
        installCmd: 'npm install',
        startCmd: 'npx vite --host 0.0.0.0 --port 3000',
        port: 3000
      };
    }
    if (deps['next']) {
      return {
        type: 'next',
        installCmd: 'npm install',
        startCmd: 'npx next dev -H 0.0.0.0 -p 3000',
        port: 3000
      };
    }
    if (deps['react-scripts']) {
      return {
        type: 'cra',
        installCmd: 'npm install',
        startCmd: 'HOST=0.0.0.0 PORT=3000 npx react-scripts start',
        port: 3000
      };
    }
    // Generic node project
    return {
      type: 'node',
      installCmd: 'npm install',
      startCmd: 'node index.js',
      port: 3000
    };
  }

  // Static HTML — serve with npx serve
  return {
    type: 'static',
    installCmd: 'npm install -g serve',
    startCmd: 'npx serve -s . -l 3000',
    port: 3000
  };
}

/**
 * Ensure required files exist for the project type.
 * AI sometimes forgets to generate index.html or other essential files.
 */
async function ensureRequiredFiles(projectDir, projectInfo) {
  const projectType = projectInfo.type;

  if (projectType === 'cra') {
    // Create React App needs public/index.html
    const publicDir = path.join(projectDir, 'public');
    const indexHtml = path.join(publicDir, 'index.html');
    try {
      await fs.access(indexHtml);
    } catch {
      await fs.mkdir(publicDir, { recursive: true });
      await fs.writeFile(indexHtml, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>App</title>
</head>
<body>
  <noscript>You need to enable JavaScript to run this app.</noscript>
  <div id="root"></div>
</body>
</html>`, 'utf8');
    }
  }

  if (projectType === 'vite') {
    // Vite needs index.html at project root
    const indexHtml = path.join(projectDir, 'index.html');
    try {
      await fs.access(indexHtml);
    } catch {
      // Check if there's a src/main.jsx or src/main.tsx
      let mainEntry = '/src/main.jsx';
      try {
        await fs.access(path.join(projectDir, 'src', 'main.tsx'));
        mainEntry = '/src/main.tsx';
      } catch {}
      try {
        await fs.access(path.join(projectDir, 'src', 'main.js'));
        mainEntry = '/src/main.js';
      } catch {}

      await fs.writeFile(indexHtml, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="${mainEntry}"></script>
</body>
</html>`, 'utf8');
    }

    // Ensure vite.config allows all hosts for preview subdomains
    const viteConfigPath = path.join(projectDir, 'vite.config.js');
    try {
      const existingConfig = await fs.readFile(viteConfigPath, 'utf8');
      if (!existingConfig.includes('allowedHosts')) {
        const patched = existingConfig.replace(
          /defineConfig\(\{/,
          'defineConfig({\n  server: { allowedHosts: true },'
        );
        await fs.writeFile(viteConfigPath, patched, 'utf8');
      }
    } catch {
      await fs.writeFile(viteConfigPath, `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: true }
})
`, 'utf8');
    }
  }

  if (projectType === 'static') {
    // Static site needs index.html at root
    const indexHtml = path.join(projectDir, 'index.html');
    try {
      await fs.access(indexHtml);
    } catch {
      await fs.writeFile(indexHtml, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>App</title>
</head>
<body>
  <h1>App is running</h1>
</body>
</html>`, 'utf8');
    }
  }

  if (projectType === 'next') {
    // Next.js needs at least pages/index.js or app/page.js
    const pagesIndex = path.join(projectDir, 'pages', 'index.js');
    const appPage = path.join(projectDir, 'app', 'page.js');
    const appPageTsx = path.join(projectDir, 'app', 'page.tsx');
    
    let hasEntry = false;
    try { await fs.access(pagesIndex); hasEntry = true; } catch {}
    try { await fs.access(appPage); hasEntry = true; } catch {}
    try { await fs.access(appPageTsx); hasEntry = true; } catch {}
    
    if (!hasEntry) {
      await fs.mkdir(path.join(projectDir, 'pages'), { recursive: true });
      await fs.writeFile(pagesIndex, `export default function Home() {
  return <div><h1>App is running</h1></div>;
}
`, 'utf8');
    }
  }

  // Ensure package.json exists (some AI responses might not include it)
  const pkgPath = path.join(projectDir, 'package.json');
  try {
    await fs.access(pkgPath);
  } catch {
    await fs.writeFile(pkgPath, JSON.stringify({
      name: 'buidlr-app',
      version: '1.0.0',
      private: true,
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: { vite: '^5.4.2', '@vitejs/plugin-react': '^4.3.1' }
    }, null, 2), 'utf8');
  }
}

/**
 * Create a Docker container with the project mounted
 */
async function createProjectContainer(sessionId, projectDir, projectInfo) {
  const Docker = require('dockerode');
  const docker = new Docker({ socketPath: config.DOCKER_SOCKET_PATH });

  const containerName = `buidlr-${sessionId}`;

  // Check if container already exists
  try {
    const existing = docker.getContainer(containerName);
    const info = await existing.inspect();

    // Container exists — restart it
    if (!info.State.Running) {
      await existing.start();
    }

    const updatedInfo = await existing.inspect();
    const hostPort = updatedInfo.NetworkSettings.Ports['3000/tcp']?.[0]?.HostPort;

    return { id: existing.id, name: containerName, port: parseInt(hostPort), status: 'running' };
  } catch (err) {
    // Container doesn't exist — create it
  }

  const container = await docker.createContainer({
    Image: 'node:20-alpine',
    name: containerName,
    WorkingDir: '/app',
    Cmd: ['sh', '-c', `${projectInfo.installCmd} && ${projectInfo.startCmd}`],
    ExposedPorts: { '3000/tcp': {} },
    HostConfig: {
      Binds: [`${projectDir}:/app`],
      PortBindings: {
        '3000/tcp': [{ HostPort: '0' }]  // Random available port
      },
      AutoRemove: false,
      RestartPolicy: { Name: 'unless-stopped' },
      Memory: 2 * 1024 * 1024 * 1024,  // 2GB memory limit per container
      CpuShares: 256,  // Limit CPU usage
    },
    Labels: {
      'buidlr.session': sessionId,
      'buidlr.type': projectInfo.type,
      'buidlr.created': new Date().toISOString()
    }
  });

  await container.start();

  const info = await container.inspect();
  const hostPort = info.NetworkSettings.Ports['3000/tcp']?.[0]?.HostPort;

  return { id: container.id, name: containerName, port: parseInt(hostPort), status: 'running' };
}

/**
 * Execute a command inside a running container
 */
async function execInContainer(containerId, command) {
  const Docker = require('dockerode');
  const docker = new Docker({ socketPath: config.DOCKER_SOCKET_PATH });
  const container = docker.getContainer(containerId);

  const exec = await container.exec({
    Cmd: ['sh', '-c', command],
    AttachStdout: true,
    AttachStderr: true,
  });

  return new Promise((resolve, reject) => {
    exec.start({ hijack: true, stdin: false }, (err, stream) => {
      if (err) return reject(err);

      let output = '';
      stream.on('data', (data) => { output += data.toString(); });
      stream.on('end', () => resolve(output));
      stream.on('error', reject);
    });
  });
}

/**
 * Setup Nginx reverse proxy for session preview
 */
async function setupNginxPreview(sessionId, port) {
  const configContent = nginxService.generatePreviewConfig(sessionId, port);
  const configPath = `/etc/nginx/sites-available/buidlr-preview-${sessionId}`;
  const enabledPath = `/etc/nginx/sites-enabled/buidlr-preview-${sessionId}`;

  try {
    await fs.writeFile(configPath, configContent, 'utf8');
    
    // Create symlink to enable
    try { await fs.unlink(enabledPath); } catch (err) {}
    await fs.symlink(configPath, enabledPath);

    // Reload nginx (not restart, so other connections aren't dropped)
    await execAsync('nginx -s reload');
  } catch (err) {
    console.error('Nginx preview setup error:', err.message);
    // Non-fatal — preview subdomain won't work but container is still accessible via port
  }
}

/**
 * Remove preview nginx config
 */
async function removeNginxPreview(sessionId) {
  try {
    await fs.unlink(`/etc/nginx/sites-enabled/buidlr-preview-${sessionId}`);
    await fs.unlink(`/etc/nginx/sites-available/buidlr-preview-${sessionId}`);
    await execAsync('nginx -s reload');
  } catch (err) {
    // Ignore
  }
}

/**
 * Clean up project files from disk
 */
async function removeProjectFiles(sessionId) {
  try {
    await fs.rm(path.join(PROJECTS_DIR, sessionId), { recursive: true, force: true });
  } catch (err) {
    // Ignore
  }
}

/**
 * Build a static version of the project for permanent hosting.
 * Runs `npm run build` inside the container, then copies the output to a static directory.
 * Returns the path to the static files.
 */
async function buildStaticVersion(sessionId) {
  const projectDir = path.join(PROJECTS_DIR, sessionId);
  const staticOutputDir = path.join(STATIC_DIR, sessionId);

  // Detect project type to know the build output directory
  const projectInfo = await detectProjectType(projectDir);

  // Determine the build output folder name
  let buildOutputFolder = 'dist'; // Vite default
  if (projectInfo.type === 'next') buildOutputFolder = '.next';
  if (projectInfo.type === 'cra') buildOutputFolder = 'build';

  // Check if container exists for this session
  const sessions = await query(
    'SELECT container_id FROM sessions WHERE id = ?',
    [sessionId]
  );

  if (!sessions[0]?.container_id) {
    throw new Error('No container found for this session');
  }

  const containerId = sessions[0].container_id;

  // Make sure container is running
  const Docker = require('dockerode');
  const docker = new Docker({ socketPath: config.DOCKER_SOCKET_PATH });
  const container = docker.getContainer(containerId);

  let info;
  try {
    info = await container.inspect();
    if (!info.State.Running) {
      await container.start();
      // Wait a moment for startup
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (err) {
    throw new Error('Container not available for build');
  }

  // Run npm run build inside the container
  try {
    await execInContainer(containerId, 'cd /app && npm run build');
  } catch (err) {
    // If build script doesn't exist, try vite build directly
    try {
      await execInContainer(containerId, 'cd /app && npx vite build');
    } catch (err2) {
      throw new Error('Build failed: ' + (err2.message || 'Unknown error'));
    }
  }

  // Copy build output from project dir to static dir
  await fs.mkdir(staticOutputDir, { recursive: true });

  const buildPath = path.join(projectDir, buildOutputFolder);

  // Check if build output exists
  try {
    await fs.access(buildPath);
  } catch {
    // Try common alternatives
    const alternatives = ['dist', 'build', 'out', '.next/static'];
    let found = false;
    for (const alt of alternatives) {
      try {
        await fs.access(path.join(projectDir, alt));
        await execAsync(`cp -r "${path.join(projectDir, alt)}"/* "${staticOutputDir}"/`);
        found = true;
        break;
      } catch {}
    }
    if (!found) {
      // Fallback: copy entire project (works for static HTML projects)
      await execAsync(`cp -r "${projectDir}"/* "${staticOutputDir}"/ 2>/dev/null; rm -rf "${staticOutputDir}/node_modules" "${staticOutputDir}/.git"`);
    }
    return staticOutputDir;
  }

  // Copy build output
  await execAsync(`cp -r "${buildPath}"/* "${staticOutputDir}"/`);

  return staticOutputDir;
}

module.exports = {
  setupSessionContainer,
  updateSessionFiles,
  detectProjectType,
  setupNginxPreview,
  removeNginxPreview,
  removeProjectFiles,
  buildStaticVersion
};
