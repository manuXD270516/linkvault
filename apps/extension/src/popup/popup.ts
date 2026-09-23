import {
  getSession,
  listGroups,
  login,
  logout,
  saveLink,
} from '../lib/bridge';
import { getBrowser } from '../lib/browser-api';
import { t } from '../lib/i18n';
import { mapSaveOutcome } from '../lib/save-link';
import type { ExtensionSession } from '../lib/storage';
import type { GroupListItem } from '../lib/api';

const loginView = mustEl('login-view');
const saveView = mustEl('save-view');
const logoutBtn = mustEl<HTMLButtonElement>('logout-btn');
const loginForm = mustEl<HTMLFormElement>('login-form');
const loginError = mustEl('login-error');
const tabUrlEl = mustEl('tab-url');
const noUrlEl = mustEl('no-url');
const destination = mustEl<HTMLSelectElement>('destination');
const saveBtn = mustEl<HTMLButtonElement>('save-btn');
const saveStatus = mustEl('save-status');
const saveError = mustEl('save-error');
const loadingEl = mustEl('global-loading');

let activeTabUrl: string | null = null;

void bootstrap();

async function bootstrap(): Promise<void> {
  applyI18n();
  setLoading(true);
  try {
    const session = await getSession();
    await showForSession(session);
  } finally {
    setLoading(false);
  }
}

function applyI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset['i18n'];
    if (key === undefined) {
      return;
    }
    const message = t(key);
    if (message.length > 0) {
      el.textContent = message;
    }
  });
  const uiLang = getBrowser().i18n.getUILanguage();
  document.documentElement.lang = uiLang.startsWith('en') ? 'en' : 'es';
}

async function showForSession(session: ExtensionSession | null): Promise<void> {
  if (session === null) {
    loginView.classList.remove('hidden');
    saveView.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    return;
  }
  loginView.classList.add('hidden');
  saveView.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  await prepareSaveView();
}

async function prepareSaveView(): Promise<void> {
  clearStatus();
  activeTabUrl = await readActiveTabHttpUrl();
  if (activeTabUrl === null) {
    tabUrlEl.textContent = '';
    noUrlEl.hidden = false;
    saveBtn.disabled = true;
  } else {
    tabUrlEl.textContent = activeTabUrl;
    noUrlEl.hidden = true;
    saveBtn.disabled = false;
  }
  await fillGroups();
}

async function fillGroups(): Promise<void> {
  const privateLabel = t('destinationPrivate') || 'Lista privada';
  destination.replaceChildren();
  const privateOption = document.createElement('option');
  privateOption.value = '';
  privateOption.textContent = privateLabel;
  destination.append(privateOption);

  let groups: GroupListItem[] = [];
  try {
    groups = await listGroups();
  } catch {
    // Sin grupos (o error de red): solo destino privado.
  }
  for (const group of groups) {
    const option = document.createElement('option');
    option.value = group.id;
    option.textContent = group.name;
    destination.append(option);
  }
  destination.value = '';
}

async function readActiveTabHttpUrl(): Promise<string | null> {
  const tabs = await getBrowser().tabs.query({ active: true, currentWindow: true });
  const url = tabs[0]?.url;
  if (url === undefined || url.length === 0) {
    return null;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return null;
  }
  return url;
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void onLogin();
});

logoutBtn.addEventListener('click', () => {
  void onLogout();
});

saveBtn.addEventListener('click', () => {
  void onSave();
});

async function onLogin(): Promise<void> {
  clearStatus();
  loginError.hidden = true;
  const email = mustEl<HTMLInputElement>('email').value.trim();
  const password = mustEl<HTMLInputElement>('password').value;
  setLoading(true);
  saveBtn.disabled = true;
  try {
    const result = await login(email, password);
    if (!result.ok) {
      loginError.textContent = t('loginError');
      loginError.hidden = false;
      return;
    }
    await showForSession(result.data as ExtensionSession);
  } finally {
    setLoading(false);
  }
}

async function onLogout(): Promise<void> {
  setLoading(true);
  try {
    await logout();
    mustEl<HTMLInputElement>('password').value = '';
    await showForSession(null);
  } finally {
    setLoading(false);
  }
}

async function onSave(): Promise<void> {
  clearStatus();
  if (activeTabUrl === null) {
    saveError.textContent = t('noTabUrl');
    saveError.hidden = false;
    return;
  }
  const groupId = destination.value === '' ? null : destination.value;
  setLoading(true);
  saveBtn.disabled = true;
  try {
    const response = await saveLink(activeTabUrl, groupId);
    const outcome = mapSaveOutcome(response);
    const primary =
      outcome.primaryMessageKey === 'saveAlreadyThereNamed' &&
      outcome.sharerName !== undefined
        ? t('saveAlreadyThereNamed', outcome.sharerName)
        : t(outcome.primaryMessageKey);
    const parts = [primary];
    if (outcome.alreadyInGroupNames.length > 0) {
      parts.push(t('saveAlreadyInGroups', outcome.alreadyInGroupNames.join(', ')));
    }
    saveStatus.textContent = parts.join(' ');
    saveStatus.hidden = false;
  } catch (error: unknown) {
    const status = (error as { status?: number }).status;
    saveError.textContent =
      status === 401 ? t('sessionExpired') : t('saveError');
    saveError.hidden = false;
    if (status === 401) {
      await showForSession(null);
    }
  } finally {
    setLoading(false);
    saveBtn.disabled = activeTabUrl === null;
  }
}

function clearStatus(): void {
  saveStatus.hidden = true;
  saveStatus.textContent = '';
  saveError.hidden = true;
  saveError.textContent = '';
  loginError.hidden = true;
  loginError.textContent = '';
}

function setLoading(loading: boolean): void {
  loadingEl.hidden = !loading;
}

function mustEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}
