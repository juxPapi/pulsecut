import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const EXPORT_DIR = path.join(DATA_DIR, 'exports');
export const PROJECT_DIR = path.join(DATA_DIR, 'projects');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const MODEL_DIR = path.join(DATA_DIR, 'models');

for (const dir of [UPLOAD_DIR, EXPORT_DIR, PROJECT_DIR, TMP_DIR, MODEL_DIR]) {
  await fs.mkdir(dir, { recursive: true });
}

const cache = new Map();

// Project ids are generated with crypto.randomUUID(). Enforcing that shape at
// the storage boundary stops route parameters like `../../package` from being
// turned into a filesystem path outside data/projects.
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (id) => PROJECT_ID.test(String(id));

function filePath(id) {
  if (!validId(id)) throw new Error('Invalid project id');
  return path.join(PROJECT_DIR, `${id}.json`);
}

export async function getProject(id) {
  if (!validId(id)) return null;
  if (cache.has(id)) return cache.get(id);
  try {
    const raw = await fs.readFile(filePath(id), 'utf8');
    const project = JSON.parse(raw);
    cache.set(id, project);
    return project;
  } catch {
    return null;
  }
}

export async function saveProject(project) {
  if (!validId(project?.id)) throw new Error('Invalid project id');
  project.updatedAt = new Date().toISOString();
  cache.set(project.id, project);
  await fs.writeFile(filePath(project.id), JSON.stringify(project, null, 2), 'utf8');
  return project;
}

export async function listProjects() {
  const files = await fs.readdir(PROJECT_DIR).catch(() => []);
  const projects = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const project = JSON.parse(await fs.readFile(path.join(PROJECT_DIR, file), 'utf8'));
      if (!validId(project.id)) continue;
      projects.push({
        id: project.id,
        name: project.name,
        duration: project.duration,
        width: project.width,
        height: project.height,
        status: project.status,
        clips: project.clips?.length || 0,
        exports: project.exports?.length || 0,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        thumb: `/api/projects/${project.id}/thumb`,
      });
    } catch {
      /* ignore a half-written file */
    }
  }
  return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function deleteProject(id) {
  if (!validId(id)) return null;
  const project = await getProject(id);
  cache.delete(id);
  await fs.rm(filePath(id), { force: true });
  if (project) {
    await fs.rm(path.join(UPLOAD_DIR, path.basename(project.filePath)), { force: true });
    await fs.rm(path.join(UPLOAD_DIR, `${id}.preview.mp4`), { force: true });
    await fs.rm(path.join(EXPORT_DIR, id), { recursive: true, force: true });
  }
  return project;
}
