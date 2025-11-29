// server.js
const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'replace_this_secret';
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Database (SQLite via Sequelize) ---
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: 'database.sqlite',
  logging: false,
});

// --- Models ---
const User = sequelize.define('User', {
  username: { type: DataTypes.STRING, unique: true, allowNull: false },
  email: { type: DataTypes.STRING, unique: true, allowNull: false },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  bio: { type: DataTypes.TEXT, allowNull: true },
  location: { type: DataTypes.STRING, allowNull: true },
});

const Post = sequelize.define('Post', {
  content: { type: DataTypes.TEXT, allowNull: false },
});

const Comment = sequelize.define('Comment', {
  content: { type: DataTypes.TEXT, allowNull: false },
});

const Follow = sequelize.define('Follow', {}, { timestamps: false });
const Like = sequelize.define('Like', {}, { timestamps: false });

// --- Associations ---
User.hasMany(Post, { as: 'posts', foreignKey: 'userId' });
Post.belongsTo(User, { as: 'author', foreignKey: 'userId' });

User.hasMany(Comment, { as: 'comments', foreignKey: 'userId' });
Comment.belongsTo(User, { as: 'author', foreignKey: 'userId' });
Post.hasMany(Comment, { as: 'comments', foreignKey: 'postId' });
Comment.belongsTo(Post, { foreignKey: 'postId' });

// Follow: many-to-many self
User.belongsToMany(User, { as: 'Followers', through: Follow, foreignKey: 'followingId', otherKey: 'followerId' });
User.belongsToMany(User, { as: 'Following', through: Follow, foreignKey: 'followerId', otherKey: 'followingId' });

// Likes
User.belongsToMany(Post, { through: Like, as: 'LikedPosts', foreignKey: 'userId' });
Post.belongsToMany(User, { through: Like, as: 'Likers', foreignKey: 'postId' });

// --- Helpers ---
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing token' });
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findByPk(payload.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// --- Routes ---
// Health
app.get('/api/ping', (req, res) => res.json({ ok: true }));

// Auth: register
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, location, bio } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'username, email, password required' });
  try {
    const passwordHash = await hashPassword(password);
    const user = await User.create({ username, email, passwordHash, location, bio });
    const token = generateToken(user);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, location: user.location, bio: user.bio } });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Auth: login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ where: { email }});
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
  const token = generateToken(user);
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, location: user.location, bio: user.bio }});
});

// Get user profile (including counts)
app.get('/api/users/:id', async (req, res) => {
  const user = await User.findByPk(req.params.id, {
    attributes: ['id', 'username', 'email', 'bio', 'location', 'createdAt'],
    include: [
      { model: Post, as: 'posts', attributes: ['id'] },
      { model: User, as: 'Followers', attributes: ['id'] },
      { model: User, as: 'Following', attributes: ['id'] },
    ]
  });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: user.id,
    username: user.username,
    bio: user.bio,
    location: user.location,
    postsCount: user.posts.length,
    followersCount: user.Followers.length,
    followingCount: user.Following.length,
  });
});

// Follow / Unfollow
app.post('/api/users/:id/follow', authMiddleware, async (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.id === targetId) return res.status(400).json({ error: "Can't follow yourself" });
  const target = await User.findByPk(targetId);
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Check if already following
  const exists = await Follow.findOne({ where: { followerId: req.user.id, followingId: targetId }});
  if (exists) {
    // Unfollow
    await exists.destroy();
    return res.json({ ok: true, following: false });
  } else {
    await Follow.create({ followerId: req.user.id, followingId: targetId });
    return res.json({ ok: true, following: true });
  }
});

// Create post
app.post('/api/posts', authMiddleware, async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const post = await Post.create({ content, userId: req.user.id });
  res.json({ post });
});

// List posts (simple feed)
app.get('/api/posts', async (req, res) => {
  const posts = await Post.findAll({
    order: [['createdAt', 'DESC']],
    include: [
      { model: User, as: 'author', attributes: ['id', 'username', 'location'] },
      { model: User, as: 'Likers', attributes: ['id', 'username'] },
      { model: Comment, as: 'comments', include: [{ model: User, as: 'author', attributes: ['id','username']}], order: [['createdAt','ASC']] },
    ]
  });
  // Simplify output
  const out = posts.map(p => ({
    id: p.id,
    content: p.content,
    createdAt: p.createdAt,
    author: p.author,
    likesCount: p.Likers ? p.Likers.length : 0,
    likedBy: p.Likers ? p.Likers.map(u => ({ id: u.id, username: u.username })) : [],
    comments: (p.comments || []).map(c => ({ id: c.id, content: c.content, author: c.author, createdAt: c.createdAt })),
  }));
  res.json(out);
});

// Comment on post
app.post('/api/posts/:id/comments', authMiddleware, async (req, res) => {
  const postId = Number(req.params.id);
  const post = await Post.findByPk(postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content required' });
  const comment = await Comment.create({ content, userId: req.user.id, postId });
  const full = await Comment.findByPk(comment.id, { include: [{ model: User, as: 'author', attributes: ['id','username']}]});
  res.json(full);
});

// Like/unlike post
app.post('/api/posts/:id/like', authMiddleware, async (req, res) => {
  const postId = Number(req.params.id);
  const post = await Post.findByPk(postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });
  const existing = await Like.findOne({ where: { userId: req.user.id, postId }});
  if (existing) {
    await existing.destroy();
    return res.json({ liked: false });
  } else {
    await Like.create({ userId: req.user.id, postId });
    return res.json({ liked: true });
  }
});

// Simple search or get user's posts
app.get('/api/users/:id/posts', async (req, res) => {
  const posts = await Post.findAll({ where: { userId: req.params.id }, include: [{ model: User, as: 'author', attributes: ['id','username'] }], order: [['createdAt','DESC']] });
  res.json(posts);
});

// Start server and sync DB
(async () => {
  await sequelize.sync({ alter: true });
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Server listening on port', port));
})();
