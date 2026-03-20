import sqlite3
c = sqlite3.connect('forma.db')
print("WORKOUTS:")
for row in c.execute('SELECT * FROM workouts'): print(row)
print("EXERCISES:")
for row in c.execute('SELECT * FROM exercises'): print(row)
