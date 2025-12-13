const express = require('express');
const cors = require('cors');
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const port = process.env.PORT || 3000

// stripe require
const stripe = require('stripe')(`${process.env.STRIPE_SECRET}`);


// firebase service account
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FIREBASE_ADMIN_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

app.use(cors())
app.use(express.json())

// verify FB token
const verifyFbToken = async (req, res, next) => {
    const authorization = req.headers.authorization;

    if (!authorization) {
        return res.status(401).json({
            message: "Unauthorized access"
        })
    }
    const token = authorization.split(" ")[1]

    if (!token) {
        return res.status(401).json({
            message: "Unauthorized access"
        })
    }

    try {
        const decoded = await admin.auth().verifyIdToken(token)
        req.decoded_email = decoded.email
        next()
    } catch {
        return res.status(401).json({
            message: "Unauthorized access"
        })
    }
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@personal-hero.gxzvpbe.mongodb.net/?appName=Personal-Hero`;


const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        const db = client.db("Swift_Tix_DB")
        const usersCollection = db.collection('users')
        const ticketsCollection = db.collection('tickets')
        const paymentsCollection = db.collection('payments')

        app.get('/', (req, res) => {
            res.send('Swift-Tix server is working')
        })

        // get role
        app.get('/role', async (req, res) => {
            try {
                const email = req.query.email
                const query = { email: email }
                const result = await usersCollection.findOne(query, {
                    projection: { role: 1 }
                })

                res.send({ role: result.role || 'user' })
            } catch (err) {
                res.status(500).send({ message: "couldn't get role", err })
            }
        })
        // advertisement api
        app.get('/advertisement', async (req, res) => {
            try {
                const result = await ticketsCollection.find({
                    verification_status: 'accepted',
                    advertise: true
                }).toArray()

                res.send(result)
            } catch (err) {
                res.send({ message: "Could't get advertizes" })
            }
        })
        // get latest tickets 
        app.get('/latest', async (req, res) => {
            try {
                const result = await ticketsCollection.find({ verification_status: 'accepted' }).sort({ _id: -1 }).limit(6).toArray()
                res.send(result)
            } catch (err) {
                res.send({ message: "Could't get latest tickets", err })
            }
        })

        // vendor stats
        app.get('/vendor/dashboard-stats', async (req, res) => {
            try {
                const { email } = req.query;

                if (!email) {
                    return res.status(400).send({ message: "Vendor email required" });
                }

                const result = await ticketsCollection
                    .aggregate(pipeline(email))
                    .toArray();

                const stats = result[0] || {
                    totalRevenue: 0,
                    totalTicketsSold: 0,
                    totalTicketsAdded: 0
                };

                res.send({
                    success: true,
                    stats
                });

            } catch (err) {
                res.status(500).send({
                    success: false,
                    message: "Failed to load dashboard stats",
                    error: err.message
                });
            }
        });


        // users related api
        app.get('/users', async (req, res) => {
            try {
                const query = {};
                const result = await usersCollection.find(query).toArray()
                res.send(result)
            } catch (err) {
                res.send({ message: "Could't get users" })
            }
        })

        app.post('/users', async (req, res) => {
            try {
                const user = req.body;
                const email = req.body.email
                user.created_at = new Date()
                user.role = 'user'

                const existingUser = await usersCollection.findOne({ email: email })

                if (existingUser) {
                    return res.send({ message: "User already exists in Database" })
                }

                const result = usersCollection.insertOne(user)
                res.send(result)
            }
            catch (err) {
                res.send("error while creating user in DB", err)
            }
        })

        app.patch('/update/role', async (req, res) => {
            try {
                const id = req.body.id
                const role = req.body.updatedRole
                const query = { _id: new ObjectId(id) }
                const updatedDoc = {
                    $set: {
                        role: role
                    }
                }
                const result = await usersCollection.updateOne(query, updatedDoc)
                res.status(200).send(result)
            } catch (err) {
                res.status(500).json({ message: "failed to remove admin", err })
            }
        })

        // ticket related apis

        app.get('/tickets', async (req, res) => {
            try {
                const { status } = req.query
                const { email } = req.query
                const query = {}
                if (email) {
                    query.vendorEmail = email
                }
                if (status) {
                    query.verification_status = status
                }

                const result = await ticketsCollection.find(query).sort({ _id: -1 }).toArray()
                res.status(200).send(result)
            } catch (err) {
                res.status(500).json({ message: "Couldn't get tickets", err })
            }
        })

        app.get('/ticket/:id', verifyFbToken, async (req, res) => {
            try {
                const { id } = req.params;
                const query = { _id: new ObjectId(id) }
                const result = await ticketsCollection.findOne(query)
                res.status(200).send(result)
            } catch (err) {
                res.status(500).send({ message: "Couldn't get ticket by id", err })
            }
        })

        app.get('/all-tickets', async (req, res) => {
            try {
                const status = req.query.status
                if (!status || status !== 'accepted') {
                    return res.status(500).json({ message: "Bad request" })
                }
                const query = { verification_status: status }
                const result = await ticketsCollection.find(query).toArray()
                res.send(result)
            } catch (err) {
                res.status(500).send({ message: "Couldn't get all the tickets", err })
            }
        })

        app.post('/tickets', verifyFbToken, async (req, res) => {
            try {
                const ticketInfo = req.body;
                ticketInfo.verification_status = 'pending'
                ticketInfo.advertise = false

                const result = await ticketsCollection.insertOne(ticketInfo)

                res.send(result)
            } catch (err) {
                res.status(500).send({ message: "Couldn't post the tickets", err })
            }
        })

        app.patch('/tickets/status', async (req, res) => {
            try {
                const { id } = req.body;
                const { status } = req.body;

                const query = { _id: new ObjectId(id) };
                const updatedDoc = {
                    $set: {
                        verification_status: status
                    }
                }

                const result = await ticketsCollection.updateOne(query, updatedDoc)
                res.status(200).json(result)
            } catch (err) {
                res.status(500).json({ message: "Couldn't update ticket status", err })
            }
        })

        app.patch('/tickets/advertise/:id', async (req, res) => {
            try {
                const { id } = req.params
                const { advertise } = req.body
                console.log(advertise)
                if (advertise) {
                    const count = await ticketsCollection.countDocuments({ advertise: true })
                    console.log(count)
                    if (count > 5) {
                        return res.status(400).json({
                            success: false,
                            message: "Cannot advertise more than 6 at a time"
                        })
                    }
                }

                const query = { _id: new ObjectId(id) }
                const updatedDoc = {
                    $set: {
                        advertise: advertise
                    }
                }
                const result = await ticketsCollection.updateOne(query, updatedDoc)
                return res.status(200).send(result)
            } catch (err) {
                res.status(500).json({ message: "Couldn't set advertise", err })
            }
        })

        app.patch('/tickets/update/:id', verifyFbToken, async (req, res) => {
            try {
                const { id } = req.params
                const ticketInfo = req.body;

                const query = { _id: new ObjectId(id) }
                const updatedDoc = {
                    $set: {
                        ...ticketInfo,
                        verification_status: 'pending'
                    }
                }

                const result = await ticketsCollection.updateOne(query, updatedDoc)

                res.status(200).send(result)

            } catch (err) {
                res.status(500).json({ message: "Couldn't update tickets", err })
            }
        })

        app.delete('/tickets/delete/:id', verifyFbToken, async (req, res) => {
            try {
                const { id } = req.params;
                const result = await ticketsCollection.deleteOne({
                    _id: new ObjectId(id)
                })

                res.status(200).send(result)

            } catch (err) {
                res.status(500).send({ message: "Couldn't delete ticket", err })
            }
        })

        // booking related apis
        app.get('/bookings', async (req, res) => {
            try {
                const { email } = req.query;

                if (!email) {
                    return res.status(400).send({ message: "Missing email query parameter." });
                }

                const pipeline = [
                    {
                        $match: {
                            "bookings.bookedBy": email
                        }
                    },

                    {
                        $unwind: "$bookings"
                    },

                    {
                        $match: {
                            "bookings.bookedBy": email
                        }
                    },

                    {
                        $project: {
                            ticketName: 1,
                            transport_type: 1,
                            departure: 1,
                            from: 1,
                            to: 1,
                            price: 1,
                            ticketURL: 1,
                            bookings: 1,
                        }
                    }
                ];

                const result = await ticketsCollection.aggregate(pipeline).sort({ "bookings.bookingId": -1 }).toArray();

                res.status(200).send(result);

            } catch (err) {
                console.error("Booking Fetch Error:", err);
                res.status(500).send({ message: "Couldn't get booked tickets", error: err.message });
            }
        });

        app.patch('/bookings/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const bookingData = req.body;
                const query = { _id: new ObjectId(id) }

                const insertBooking = {
                    $push: {
                        bookings: {
                            bookingId: new ObjectId(),
                            ...bookingData
                        }
                    }
                }

                const result = await ticketsCollection.updateOne(query, insertBooking)
                res.status(200).send(result)
            } catch (err) {
                res.status(500).send({ message: "Couldn't place booking", err })
            }
        })

        app.patch('/bookings/status/:id', async (req, res) => {
            try {
                const { id } = req.params;
                const { bookingId, status, paymentStatus } = req.body;
                const query = { _id: new ObjectId(id), "bookings.bookingId": new ObjectId(bookingId) }
                if (status === 'rejected') {
                    const updatedDoc = {
                        $set: {
                            "bookings.$.booking_status": status
                        }
                    }
                    const result = await ticketsCollection.updateOne(query, updatedDoc)
                    return res.status(200).send(result)
                }
                const updatedDoc = {
                    $set: {
                        "bookings.$.booking_status": status,
                        "bookings.$.paymentStatus": paymentStatus
                    }
                }
                const result = await ticketsCollection.updateOne(query, updatedDoc)
                res.status(200).send(result)
            } catch (err) {
                res.status(500).send({ message: "Couldn't update booking status", err })
            }

        })

        // payment related API
        app.get('/payment-history', async (req, res) => {
            try {
                const { email } = req.query;
                const query = { bookedBy: email }

                const result = await paymentsCollection.find(query).toArray()
                res.send(result)

            } catch (err) {
                res.status(500).send({ message: "Couldn't get transaction history", err })
            }
        })

        app.post('/create-checkout-session', async (req, res) => {
            try {
                const { basePrice, ticketName, ticketURL, bookedBy, bookedQuantity, ticketId, bookingId } = req.body
                const session = await stripe.checkout.sessions.create({
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                unit_amount: basePrice * 100,
                                product_data: {
                                    name: ticketName,
                                    images: [ticketURL],
                                    description: `Paying for ${bookedQuantity} ${bookedQuantity == 1 ? 'ticket' : 'tickets'} of ${ticketName}`
                                },
                            },
                            quantity: bookedQuantity,
                        },
                    ],
                    customer_email: bookedBy,
                    metadata: {
                        ticketId,
                        bookingId,
                        bookedQuantity,
                        bookedBy,
                        ticketName,
                    },
                    mode: 'payment',
                    success_url: `${process.env.SITE_DOMAIN}dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${process.env.SITE_DOMAIN}dashboard/payment-cancel`,
                })
                res.send({ url: session.url })
            }
            catch (err) {
                res.status(500).send({ message: "Couldn't create checkout session", err })
            }
        })

        app.patch('/verify-payment', async (req, res) => {
            try {
                const sessionId = req.query.sessionId
                const session = await stripe.checkout.sessions.retrieve(sessionId)
                if (session.payment_status === 'paid') {

                    const { bookingId, ticketId, bookedQuantity, ticketName, bookedBy, } = session.metadata
                    const transaction_id = session.payment_intent

                    // payment data to store on payments collection 
                    const paymentData = {
                        ticketName,
                        ticketId,
                        bookingId,
                        bookedQuantity,
                        transaction_id,
                        bookedBy,
                        totalPrice: session.amount_total,
                        payment_date: session.created
                    }

                    const existingPayment = await paymentsCollection.findOne({ transaction_id: transaction_id })
                    if (existingPayment) {
                        return res.status(200).send({ message: "Already processed", paymentData })
                    }


                    const query = { _id: new ObjectId(ticketId), "bookings.bookingId": new ObjectId(bookingId) }

                    const updatedDoc = {
                        $set: {
                            "bookings.$.paymentStatus": 'paid',
                            "bookings.$.transaction_id": transaction_id,
                            "bookings.$.payment_created": session.created
                        },
                        $inc: {
                            quantity: -Number(bookedQuantity)
                        }
                    }
                    // update according to the payment
                    await ticketsCollection.updateOne(query, updatedDoc)


                    const result = await paymentsCollection.insertOne(paymentData)
                    res.status(200).send({ result, paymentData })
                }
            } catch (err) {
                res.status(500).send({ message: "Couldn't retrieve payment data", err })
            }
        })

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");

    } finally {
    }
}
run().catch(console.dir);


app.listen(port, (req, res) => {
    console.log("Swift-Tix server is running on port:", port)
})
