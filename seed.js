const { read, write } = require('./db');
const { hashPassword } = require('./auth');

function seed() {
  const db = read();
  if (db.users.length > 0) {
    console.log('Users already exist — skip seed. Delete data/db.json to re-seed.');
    return;
  }

  const adminPw = hashPassword('admin123');
  const teacherPw = hashPassword('teacher123');
  const teacher2Pw = hashPassword('teacher123');

  db.users = [
    {
      id: 'u-admin',
      email: 'admin@school.edu',
      name: 'District Admin',
      role: 'admin',
      school: 'Silver Valley USD',
      districtId: 'svusd',
      salt: adminPw.salt,
      hash: adminPw.hash
    },
    {
      id: 'u-teacher1',
      email: 'teacher@school.edu',
      name: 'PE Teacher One',
      role: 'teacher',
      school: 'Fort Irwin Middle School',
      districtId: 'svusd',
      salt: teacherPw.salt,
      hash: teacherPw.hash
    },
    {
      id: 'u-teacher2',
      email: 'teacher2@school.edu',
      name: 'PE Teacher Two',
      role: 'teacher',
      school: 'Barstow Elementary',
      districtId: 'svusd',
      salt: teacher2Pw.salt,
      hash: teacher2Pw.hash
    }
  ];

  write(db);
  console.log('Seeded users:');
  console.log('  Admin:   admin@school.edu / admin123');
  console.log('  Teacher: teacher@school.edu / teacher123');
  console.log('  Teacher: teacher2@school.edu / teacher123');
}

seed();
