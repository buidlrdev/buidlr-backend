/**
 * Git service - repository operations using simple-git
 */

const simpleGit = require('simple-git');
const path = require('path');

/**
 * Clone a repository with PAT authentication
 * @param {string} repoUrl - Repository URL (https://github.com/user/repo.git)
 * @param {string} pat - Personal Access Token
 * @param {string} destPath - Destination path for clone
 */
async function cloneRepo(repoUrl, pat, destPath) {
  // Insert PAT into URL for authentication
  const authedUrl = repoUrl.replace('https://', `https://${pat}@`);
  
  const git = simpleGit();
  await git.clone(authedUrl, destPath);
  
  return { success: true, path: destPath };
}

/**
 * Commit all changes and push to remote
 * @param {string} repoPath - Path to local repository
 * @param {string} message - Commit message
 * @param {string} pat - Personal Access Token
 */
async function commitAndPush(repoPath, message, pat) {
  const git = simpleGit(repoPath);
  
  // Get remote URL and add PAT
  const remotes = await git.getRemotes(true);
  const origin = remotes.find(r => r.name === 'origin');
  
  if (origin && origin.refs.push) {
    const authedUrl = origin.refs.push.replace('https://', `https://${pat}@`);
    await git.remote(['set-url', 'origin', authedUrl]);
  }
  
  // Add all changes
  await git.add('.');
  
  // Commit
  await git.commit(message);
  
  // Push
  await git.push('origin', 'HEAD');
  
  return { success: true };
}

/**
 * Get repository status
 * @param {string} repoPath - Path to local repository
 */
async function getStatus(repoPath) {
  const git = simpleGit(repoPath);
  const status = await git.status();
  return status;
}

module.exports = {
  cloneRepo,
  commitAndPush,
  getStatus
};
