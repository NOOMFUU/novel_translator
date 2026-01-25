// createAdmin.js
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

// เชื่อมต่อ Database
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to DB'))
  .catch(err => console.error(err));

const createAdmin = async () => {
    try {
        const username = "admin"; // <--- แก้ชื่อตรงนี้
        const password = "1234";  // <--- แก้รหัสตรงนี้

        // เช็คว่ามี user นี้หรือยัง
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            console.log('User already exists');
            return;
        }

        // เข้ารหัสรหัสผ่าน
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // บันทึกลง DB
        await User.create({
            username,
            password: hashedPassword
        });

        console.log(`✅ Admin user created: ${username}`);
    } catch (err) {
        console.error(err);
    } finally {
        mongoose.connection.close();
    }
};

createAdmin();