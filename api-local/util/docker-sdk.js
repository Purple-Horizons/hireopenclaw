const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function getContainer(containerName) {
  return docker.getContainer(containerName);
}

async function restartContainer(containerName) {
  const container = docker.getContainer(containerName);
  await container.restart();
  return { ok: true };
}

async function pauseContainer(containerName) {
  const container = docker.getContainer(containerName);
  await container.pause();
  return { ok: true };
}

async function unpauseContainer(containerName) {
  const container = docker.getContainer(containerName);
  await container.unpause();
  return { ok: true };
}

async function stopContainer(containerName) {
  const container = docker.getContainer(containerName);
  await container.stop();
  await container.remove();
  return { ok: true };
}

async function getContainerLogs(containerName, lines = 50) {
  const container = docker.getContainer(containerName);
  const logs = await container.logs({
    stdout: true,
    stderr: true,
    tail: lines,
    timestamps: false
  });
  // Docker logs come as Buffer with multiplexed streams
  return logs.toString('utf8').split('\n').filter(Boolean);
}

async function inspectContainer(containerName) {
  const container = docker.getContainer(containerName);
  const data = await container.inspect();
  return {
    id: data.Id?.slice(0, 12),
    status: data.State?.Status,
    health: data.State?.Health?.Status,
    started: data.State?.StartedAt,
    image: data.Config?.Image,
    ports: data.NetworkSettings?.Ports
  };
}

async function getContainerConfig(containerName, filePath) {
  const container = docker.getContainer(containerName);
  const exec = await container.exec({
    Cmd: ['cat', filePath],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start();
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    // dockerode exposes a helper to split multiplexed stdout/stderr streams.
    docker.modem.demuxStream(
      stream,
      { write: (chunk) => { stdout += chunk.toString('utf8'); } },
      { write: (chunk) => { stderr += chunk.toString('utf8'); } }
    );

    stream.on('end', async () => {
      try {
        const meta = await exec.inspect();
        if (meta.ExitCode !== 0) {
          return reject(new Error(stderr.trim() || `cat failed for ${filePath}`));
        }
        resolve(stdout);
      } catch (err) {
        reject(err);
      }
    });
    stream.on('error', reject);
  });
}

module.exports = { docker, getContainer, restartContainer, pauseContainer, unpauseContainer, stopContainer, getContainerLogs, inspectContainer, getContainerConfig };
