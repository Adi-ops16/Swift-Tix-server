const express = require('express');
const cors = require('cors');
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const port = process.env.PORT || 3000

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
                const result = await ticketsCollection.find().sort({ _id: -1 }).limit(6).toArray()
                res.send(result)
            } catch (err) {
                res.send({ message: "Could't get latest tickets", err })
            }
        })

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


        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");

    } finally {
    }
}
run().catch(console.dir);


app.listen(port, (req, res) => {
    console.log("Swift-Tix server is running on port:", port)
})
