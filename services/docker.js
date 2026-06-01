/**
 * Docker service - container management using dockerode
 */

const Docker = require('dockerode');
const config = require('../config');

const docker = new Docker({ socketPath: config.DOCKER_SOCKET_PATH });

/**
 * Create and start a container for a session
 * Container is named buidlr-{sessionId} for easy identification
 */
async function createContainer(sessionId, imageName) {
  const containerName = `buidlr-${sessionId}`;

  // Check if container already exists (from previous run)
  try {
    const existing = docker.getContainer(containerName);
    const info = await existing.inspect();
    
    // Container exists — if stopped, restart it
    if (!info.State.Running) {
      await existing.start();
    }
    
    const updatedInfo = await existing.inspect();
    const hostPort = updatedInfo.NetworkSettings.Ports['3000/tcp']?.[0]?.HostPort;
    
    return {
      id: existing.id,
      name: containerName,
      port: hostPort,
      status: 'running'
    };
  } catch (err) {
    // Container doesn't exist — create new one
  }

  const container = await docker.createContainer({
    Image: imageName,
    name: containerName,
    ExposedPorts: { '3000/tcp': {} },
    HostConfig: {
      PortBindings: {
        '3000/tcp': [{ HostPort: '0' }] // Random available port
      },
      AutoRemove: false, // IMPORTANT: never auto-remove
      RestartPolicy: { Name: 'unless-stopped' }
    },
    Labels: {
      'buidlr.session': sessionId,
      'buidlr.created': new Date().toISOString()
    }
  });

  await container.start();

  const info = await container.inspect();
  const hostPort = info.NetworkSettings.Ports['3000/tcp']?.[0]?.HostPort;

  return {
    id: container.id,
    name: containerName,
    port: hostPort,
    status: 'running'
  };
}

/**
 * Stop a container WITHOUT removing it
 * Container can be restarted later
 */
async function stopContainer(containerId) {
  const container = docker.getContainer(containerId);

  try {
    const info = await container.inspect();
    if (info.State.Running) {
      await container.stop();
    }
  } catch (err) {
    if (!err.message.includes('No such container')) {
      throw err;
    }
  }

  return { status: 'stopped' };
}

/**
 * Restart a stopped container
 */
async function restartContainer(containerId) {
  const container = docker.getContainer(containerId);
  
  const info = await container.inspect();
  if (!info.State.Running) {
    await container.start();
  }

  const updatedInfo = await container.inspect();
  const hostPort = updatedInfo.NetworkSettings.Ports['3000/tcp']?.[0]?.HostPort;

  return {
    id: containerId,
    port: hostPort,
    status: 'running'
  };
}

/**
 * Remove a container permanently
 * Only called when user explicitly deletes a session
 */
async function removeContainer(containerId) {
  const container = docker.getContainer(containerId);

  try {
    const info = await container.inspect();
    if (info.State.Running) {
      await container.stop();
    }
    await container.remove();
  } catch (err) {
    if (!err.message.includes('No such container')) {
      throw err;
    }
  }

  return { removed: true };
}

/**
 * Get container status
 */
async function getContainerStatus(containerId) {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();

    const hostPort = info.NetworkSettings.Ports['3000/tcp']?.[0]?.HostPort;

    return {
      id: containerId,
      status: info.State.Running ? 'running' : 'stopped',
      running: info.State.Running,
      port: hostPort,
      startedAt: info.State.StartedAt,
      finishedAt: info.State.FinishedAt
    };
  } catch (err) {
    return { id: containerId, status: 'not_found', running: false };
  }
}

/**
 * List all buidlr containers
 */
async function listContainers() {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: ['buidlr.session'] }
  });

  return containers.map(c => ({
    id: c.Id,
    name: c.Names[0],
    status: c.State,
    sessionId: c.Labels['buidlr.session'],
    created: c.Labels['buidlr.created']
  }));
}

module.exports = {
  createContainer,
  stopContainer,
  restartContainer,
  removeContainer,
  getContainerStatus,
  listContainers
};
