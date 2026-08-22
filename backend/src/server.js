const app = require('./app');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Passenger Manifest API listening on port ${PORT}`);
});
