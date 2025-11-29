const api = '/api';
const authArea = document.getElementById('auth-area');
const createPostEl = document.getElementById('create-post');
const postContent = document.getElementById('post-content');
const btnPost = document.getElementById('btn-post');
const postsEl = document.getElementById('posts');

function token() { return localStorage.getItem('token'); }
function setToken(t) { if (t) localStorage.setItem('token', t); else localStorage.removeItem('token'); }
function currentUser() { const u = localStorage.getItem('user'); return u? JSON.parse(u): null; }
function setCurrentUser(u) { if(u) localStorage.setItem('user', JSON.stringify(u)); else localStorage.removeItem('user'); }

function renderAuth() {
  const u = currentUser();
  if (u) {
    authArea.innerHTML = `
      <span class="small">Hello, ${u.username}</span>
      <button id="btn-logout">Logout</button>
      <button id="btn-profile">Profile</button>
    `;
    createPostEl.classList.remove('hidden');
    document.getElementById('btn-logout').onclick = () => { setToken(null); setCurrentUser(null); renderAuth(); renderFeed(); };
    document.getElementById('btn-profile').onclick = () => loadProfile(u.id);
  } else {
    authArea.innerHTML = `
      <div class="auth-form">
        <input id="email" placeholder="email" />
        <input id="password" type="password" placeholder="password" />
        <button id="btn-login">Login</button>
        <button id="btn-show-register">Register</button>
      </div>
    `;
    document.getElementById('btn-login').onclick = login;
    document.getElementById('btn-show-register').onclick = showRegister;
    createPostEl.classList.add('hidden');
  }
}

async function login() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const res = await fetch(`${api}/auth/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) });
  const data = await res.json();
  if (res.ok) { setToken(data.token); setCurrentUser(data.user); renderAuth(); renderFeed(); } else alert(data.error || 'Login failed');
}

function showRegister(){
  authArea.innerHTML = `
    <div class="auth-form">
      <input id="reg-username" placeholder="username" />
      <input id="reg-email" placeholder="email" />
      <input id="reg-password" type="password" placeholder="password" />
      <button id="btn-register">Register</button>
    </div>
  `;
  document.getElementById('btn-register').onclick = register;
}

async function register(){
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const res = await fetch(`${api}/auth/register`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, email, password }) });
  const data = await res.json();
  if (res.ok) { setToken(data.token); setCurrentUser(data.user); renderAuth(); renderFeed(); } else alert(data.error || 'Register failed');
}

btnPost.onclick = async () => {
  const content = postContent.value.trim();
  if (!content) return alert('Enter something');
  const res = await fetch(`${api}/posts`, { method:'POST', headers: { 'Content-Type':'application/json', 'Authorization': 'Bearer ' + token() }, body: JSON.stringify({ content })});
  if (res.ok) { postContent.value=''; renderFeed(); } else { const e = await res.json(); alert(e.error || 'Failed'); }
}

async function renderFeed(){
  postsEl.innerHTML = 'Loading...';
  const res = await fetch(`${api}/posts`);
  const data = await res.json();
  postsEl.innerHTML = '';
  data.forEach(p => {
    const d = document.createElement('div'); d.className = 'post card';
    d.innerHTML = `
      <div class="meta"><strong>${escapeHtml(p.author.username)}</strong> • ${new Date(p.createdAt).toLocaleString()}</div>
      <div class="content">${escapeHtml(p.content)}</div>
      <div class="actions small" data-id="${p.id}">
        <span class="inline">Likes: ${p.likesCount}</span>
        <button class="btn-like inline">${p.likedBy && p.likedBy.some(u=>u.id===currentUser()?.id) ? 'Unlike' : 'Like'}</button>
        <button class="btn-comment inline">Comment</button>
        <div class="comments-area"></div>
      </div>
    `;
    postsEl.appendChild(d);

    const likeBtn = d.querySelector('.btn-like');
    likeBtn.onclick = async () => {
      const res = await fetch(`${api}/posts/${p.id}/like`, { method:'POST', headers: { 'Authorization': 'Bearer ' + token() }});
      if (res.ok) renderFeed(); else alert('Login to like');
    };

    const commentBtn = d.querySelector('.btn-comment');
    const commentsArea = d.querySelector('.comments-area');
    commentBtn.onclick = () => {
      if (!currentUser()) return alert('Login to comment');
      const form = document.createElement('div');
      form.innerHTML = `<input class="comment-input" placeholder="Write a comment" /> <button class="send-comment">Send</button>`;
      commentsArea.prepend(form);
      form.querySelector('.send-comment').onclick = async () => {
        const content = form.querySelector('.comment-input').value;
        if (!content) return;
        const res = await fetch(`${api}/posts/${p.id}/comments`, { method:'POST', headers: {'Content-Type':'application/json','Authorization':'Bearer ' + token()}, body: JSON.stringify({ content })});
        if (res.ok) renderFeed(); else alert('Failed to comment');
      };
    };

    // render existing comments
    if (p.comments && p.comments.length) {
      p.comments.forEach(c => {
        const el = document.createElement('div');
        el.className = 'comment small';
        el.innerHTML = `<strong>${escapeHtml(c.author.username)}:</strong> ${escapeHtml(c.content)}`;
        commentsArea.appendChild(el);
      });
    }
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}

async function loadProfile(userId) {
  const res = await fetch(`${api}/users/${userId}`);
  if (!res.ok) return alert('Failed to load profile');
  const p = await res.json();
  alert(`Profile: ${p.username}\nLocation: ${p.location || '-'}\nBio: ${p.bio || '-'}\nPosts: ${p.postsCount}\nFollowers: ${p.followersCount}\nFollowing: ${p.followingCount}`);
}

// init
renderAuth();
renderFeed();
