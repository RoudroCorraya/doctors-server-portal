const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const jwt = require('jsonwebtoken');
const app = express();
const port = process.env.PORT || 5000;

//middlware start
app.use(cors());
app.use(express.json());
//middlware end


//mongodb connection start
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster2.tszsqpg.mongodb.net/?retryWrites=true&w=majority`;


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

//verify jwt start
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send('unauthorized access');
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOCKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'forbiden access' })

    }
    req.decoded = decoded;
    next();
  })
}
//verify jwt end
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    //make collection start
    const appointCollection = client.db('doctorsdatabase').collection('appointoption');
    const bookingsCollection = client.db('doctorsdatabase').collection('bookings');
    const usersCollection = client.db('doctorsdatabase').collection('users');
    const doctorsCollection = client.db('doctorsdatabase').collection('doctors');
    const paymentCollection = client.db('doctorsdatabase').collection('payments');
    //make collection start

    //verify admin through middleware start
    const verifyAdmin = async (req, res, next) => {
      console.log('decoded email', req.decoded.email);
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await usersCollection.findOne(query);
      if (user.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next();
    }
    //verify admin through middleware end


    //route direction  what to do with which collection start
    app.get('/appointoptions', async (req, res) => {
      const date = req.query.date;
      console.log('dateformat cheaking', date);
      const query = {};
      const options = await appointCollection.find(query).toArray();
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
      options.forEach(option => {
        const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);

        const boookedSlot = optionBooked.map(book => book.slot);
        const remaininSolts = option.slots.filter(slot => !boookedSlot.includes(slot));
        option.slots = remaininSolts;
        console.log(option.slots);
      })
      res.send(options);
    });
    app.post('/bookings', async (req, res) => {
      const booking = req.body;
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment,

      }
      const alreadyBooked = await bookingsCollection.find(query).toArray();
      if (alreadyBooked.length) {
        const message = `you already have a booking on ${booking.appointmentDate}`;
        return res.send({ acknowledge: false, message });
      }

      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });

    app.get('/bookings', verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res.status(403).send({ message: 'forbiden access' });
      }
      console.log(req.headers.authorization);
      const query = { email: email };
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    });

    app.get('/jwt', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      if (user) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOCKEN, { expiresIn: '6h' });
        console.log(token);
        return res.send({ accessTocken: token });
      }
      console.log(user, email);
      res.status(403).send({ accessTocken: 'no token found' });

    })
    app.post('/users', async (req, res) => {
      const user = req.body;
      console.log('user cheacking', user)

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });
    //dashboard users loading start
    app.get('/users', async (req, res) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    })
    //dashboard users loading end


    //dashboard making admin start
    app.put('/users/admin/:_id', verifyJWT, verifyAdmin, async (req, res) => {
      const _id = req.params._id;
      const filter = { _id: new ObjectId(_id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter, updatedDoc, options);
      res.send(result);
    })
    //dashboard making admin end



    //dashboard user cheaking admin or not start
    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === 'admin' });
    })

    //dashboard user cheaking admin or not end

    app.get('/appointmentspeciallyty', async (req, res) => {
      const query = {};
      const result = await appointCollection.find(query).project({ name: 1 }).toArray();
      res.send(result)
    })

    //adddoctors data start
    app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorsCollection.insertOne(doctor);
      res.send(result);
    })
    //adddoctors data end

    //managedoctors data loading start
    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const doctors = await doctorsCollection.find(query).toArray();
      res.send(doctors);
    })
    //managedoctors data loading end

    //delete doctor start
    app.delete('/doctors/:_id', verifyJWT, verifyAdmin, async (req, res) => {
      const _id = req.params._id;
      const filter = { _id: new ObjectId(_id) };
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    })
    //delete doctor end

    //exploring payment method updating price start
    app.get('/addprice', async (req, res) => {
      const filter = {};
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          price: 99
        }
      }
      const result = await appointCollection.updateMany(filter, updatedDoc, options);
      res.send(result);
    })
    app.get('/bookings/:_id', async (req, res) => {
      const _id = req.params._id;
      const query = { _id: new ObjectId(_id) };
      const booking = await bookingsCollection.findOne(query);
      res.send(booking);
    })
    //exploring payment method updating price end


    //exploring stripe payment intent start
    app.post('/create-payment-intent', async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        currency: 'usd',
        amount: amount,
        "payment_method_types": [
          "card"
        ]
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    })
    //exploring stripe payment intent end

    //payment data saving in mongodb start
    app.post('/payments', async(req, res)=>{
      const payment = req.body;
      const result = await paymentCollection.insertOne(payment);
      const _id = payment.bookingId;
      const filter = {_id : new ObjectId(_id)};
      const updatedDoc ={
        $set: {
          paid: true,
          transectionId: payment.transectionId
        }
      }
      const updateresult = await bookingsCollection.updateOne(filter, updatedDoc);
      res.send(result);
    })
    //payment data saving in mongodb end

    //route direction  what to do with which collection start


  } finally {

    // await client.close();
  }
}
run().catch(console.dir);

//mongodb connection  end

app.get('/', async (req, res) => {
  res.send('doctors portal server is running');
})

app.listen(port, () => console.log(`Doctors server portal Runing on ${port}`));