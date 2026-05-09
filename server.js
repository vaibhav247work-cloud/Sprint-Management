const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Connect to SQLite DB
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
    db.run(`CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        state_data TEXT
    )`, (err) => {
      if (err) {
        console.log("Table creation error", err);
      } else {
        // Initialize with default state if empty
        db.get("SELECT COUNT(*) AS count FROM app_state", (err, row) => {
          if (row.count === 0) {
            db.run(`INSERT INTO app_state (state_data) VALUES (?)`, ['{}']);
          }
        });
      }
    });
  }
});

// GET state
app.get('/api/state', (req, res) => {
  db.get("SELECT state_data FROM app_state ORDER BY id DESC LIMIT 1", (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    try {
      if (!row) {
         res.json({});
         return;
      }
      const data = JSON.parse(row.state_data);
      res.json(data);
    } catch (e) {
      res.json({});
    }
  });
});

// POST state
app.post('/api/state', (req, res) => {
  const stateData = JSON.stringify(req.body);
  
  db.get("SELECT id FROM app_state ORDER BY id DESC LIMIT 1", (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      db.run(`INSERT INTO app_state (state_data) VALUES (?)`, [stateData], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    } else {
      db.run(`UPDATE app_state SET state_data = ? WHERE id = ?`, [stateData, row.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'State saved' });
      });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
