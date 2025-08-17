// server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const Stripe = require("stripe");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
var admin = require("firebase-admin");
const jwt = require("jsonwebtoken");
// Load environment variables
dotenv.config();
// console.log("Api key: ", process.env.STRIPE_SECRET_KEY);
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// mongodb uri
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@clustercraft.fp390uo.mongodb.net/?retryWrites=true&w=majority&appName=ClusterCraft`;

// client
// Create a MongoClient with a MongoClientOptions object to set the Stable API version

// var serviceAccount = require("path/to/serviceAccountKey.json");

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });

const base64 = process.env.FB_SERVICE_KEY;
const decodedJson = Buffer.from(base64, "base64").toString("utf-8");

const serviceAccount = JSON.parse(decodedJson);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// verify client side request firebase token
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers?.authorization;
  const token = authHeader?.split(" ")[1];

  // checks if authHeader exist or not, if exist? then also check if it's starts with Bearer or not
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized request" });
  }

  // decoded token
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (error) {
    console.log("Error while decoded data: ", error);
    return res.status(401).send({ message: "Unauthorized request" });
  }
};

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Check if Authorization header exists and starts with "Bearer "
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized: Token missing" });
    }

    // Extract token from header
    const token = authHeader.split(" ")[1];

    // Verify token using secret key
    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: "Unauthorized: Invalid token" });
      }

      // Attach decoded info to the request for later middleware/routes
      req.decoded = decoded;
      next();
    });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// verify admin role middleware
const verifyAdminRole = async (req, res, next) => {
  try {
    const email = req.decoded?.email;

    if (!email) {
      return res
        .status(401)
        .json({ message: "Unauthorized: Email missing from token" });
    }

    const database = client.db("MediCamp"); // getDB should return your MongoDB database instance
    const user = await database
      .collection("UsersCollection")
      .findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: Admins only" });
    }

    // User is an admin, continue
    next();
  } catch (error) {
    console.error("verifyAdminRole error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    // connecting to the main MediCamp database
    const database = client.db("MediCamp");

    // MediCamp users collection
    const UsersCollection = database.collection("UsersCollection");

    // MediCamp camps collection
    const CampsCollection = database.collection("CampsCollection");

    // MediCamp registered participants collection
    const registeredParticipantsCollection = database.collection(
      "registeredParticipantsCollection"
    );

    // Medicamp camp feedback collection
    const feedbackCollection = database.collection("feedbackCollection");

    // --------------------------------------------POST------------------------------

    // post method from client side to get the users data
    app.post("/users", async (req, res) => {
      const usersData = req.body;
      const result = await UsersCollection.insertOne(usersData);
      res.send(result);
    });

    // post method to get camps details from the client side
    app.post("/camps", async (req, res) => {
      try {
        const camps = req.body;

        // console.log("Added camps: ", camps)
        const result = await CampsCollection.insertOne(camps);
        res.send(result);
      } catch (error) {
        console.log("Error while getting camps data: ", error);
      }
    });
    // testing
    // post method to get registered participant details
    app.post("/registered-participant", async (req, res) => {
      const registeredParticipants = req.body;
      // console.log(registeredParticipants);

      const result = await registeredParticipantsCollection.insertOne(
        registeredParticipants
      );
      res.send(result);
    });

    // Stripe payment
    app.post("/create-payment-session", async (req, res) => {
      const { campTitle, campId, amount, userEmail } = req.body;

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          metadata: {
            campId,
          },
          customer_email: userEmail,
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: Math.round(Number(amount / 126) * 100), // ✅ Safe conversion
                product_data: {
                  name: campTitle,
                  description: `Camp ID: ${campId}`,
                },
              },
              quantity: 1,
            },
          ],
          success_url: `https://carecamp-06.web.app/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `https://carecamp-06.web.app/payment-cancelled`,
        });

        res.send({ url: session.url });
      } catch (err) {
        console.error("Stripe session error:", err);
        res.status(500).json({ error: err.message });
      }
    });

    // posting feedback collection
    app.post("/feedback", async (req, res) => {
      const feedbackData = req.body;
      // console.log("feedback data: ", feedbackData);

      try {
        const result = await feedbackCollection.insertOne({
          ...feedbackData,
          createdAt: new Date().toISOString(), // Add timestamp
        });

        res.status(201).send({
          message: "Feedback submitted successfully!",
          insertedId: result.insertedId,
        });
      } catch (error) {
        console.error("Error submitting feedback:", error);
        res.status(500).json({ error: "Failed to submit feedback" });
      }
    });

    // post method for get the payload from the client and generate token for each new login
    app.post("/jwt", async (req, res) => {
      const { email } = req.body;
      console.log("Jwt mail: ", email);

      // Validate email
      if (!email) {
        return res.status(400).json({ message: "Email is required" });
      }

      // 1️⃣ Create payload with user info (usually email)
      const user = { email };

      // 2️⃣ Sign the token with your secret key
      const token = jwt.sign(user, process.env.JWT_SECRET, {
        expiresIn: "7d", // valid for 7 days
      });

      // 3️⃣ Send token to client
      res.send({ token });
    });

    // --------------------------------------------GET------------------------------

    // get method for get the users data
    app.get("/users", verifyToken, async (req, res) => {
      // logged users email
      const email = req.decoded.email;
      const loggedUserData = await UsersCollection.findOne({ email });
      res.send(loggedUserData);
    });

    // GET method to get all users data for admin
    app.get("/all-users", verifyToken, verifyAdminRole, async (req, res) => {
      try {
        const users = await UsersCollection.find({}).toArray();
        res.send(users);
      } catch (error) {
        console.error("Error fetching all users:", error);
        res
          .status(500)
          .json({ message: "Server error while fetching users data" });
      }
    });

    app.get("/camps", async (req, res) => {
      try {
        const { search = "", sort = "", page = 1, limit = 9 } = req.query;

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);

        const query = {
          $or: [
            { campName: { $regex: search, $options: "i" } },
            { location: { $regex: search, $options: "i" } },
            { healthcareProfessional: { $regex: search, $options: "i" } },
            { description: { $regex: search, $options: "i" } },
          ],
        };

        const sortOptions = {};
        if (sort === "participant") {
          sortOptions.participantCount = -1;
        } else if (sort === "feesLow") {
          sortOptions.campFees = 1;
        } else if (sort === "feesHigh") {
          sortOptions.campFees = -1;
        } else if (sort === "name") {
          sortOptions.campName = 1;
        }

        const total = await CampsCollection.countDocuments(query);
        const result = await CampsCollection.find(query)
          .sort(sortOptions)
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .toArray();

        res.send({ total, result });
      } catch (error) {
        console.error("Failed to fetch camps:", error);
        res.status(500).send({ message: "Server error while fetching camps." });
      }
    });

    app.get("/camps/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const query = { _id: new ObjectId(id) };
        const camp = await CampsCollection.findOne(query);

        res.send(camp);
      } catch (error) {
        console.error("Error fetching camp:", error);
        res.status(500).json({ message: "Server error while fetching camp" });
      }
    });

    // GET method to get registered participants for the logged-in user
    app.get("/registered-participant", verifyToken, async (req, res) => {
      try {
        const loggedUserEmail = req.decoded.email;

        const registeredParticipantsData =
          await registeredParticipantsCollection
            .find({ loggedUserEmail }) // Only return data for this user
            .toArray();

        res.send(registeredParticipantsData);
      } catch (error) {
        console.error("Error fetching registered participants:", error);
        res.status(500).json({ message: "Server error while fetching data" });
      }
    });

    // GET  method to get all registered  participants data for admin
    app.get(
      "/all-registered-participant",
      verifyToken,
      verifyAdminRole,
      async (req, res) => {
        try {
          const registeredParticipantsData =
            await registeredParticipantsCollection.find().toArray();

          res.send(registeredParticipantsData);
        } catch (error) {
          console.error("Error fetching registered participants:", error);
          res.status(500).json({ message: "Server error while fetching data" });
        }
      }
    );

    // fetching session
    app.get("/session-details/:sessionId", async (req, res) => {
      try {
        const session = await stripe.checkout.sessions.retrieve(
          req.params.sessionId
        );
        res.send(session); // includes payment_intent
      } catch (error) {
        console.error("Error fetching session:", error);
        res.status(500).json({ error: "Failed to retrieve session details" });
      }
    });

    // ✅ GET Top 6 Popular Medical Camps
    app.get("/popular-camps", async (req, res) => {
      try {
        const result = await CampsCollection.find()
          .sort({ participantCount: -1 })
          .limit(6)
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Failed to fetch popular camps:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get("/feedback", async (req, res) => {
      try {
        // You can optionally sort by newest feedback first
        const result = await feedbackCollection
          .find()
          .sort({ _id: -1 }) // newest first
          .toArray();

        res.status(200).send(result);
      } catch (error) {
        console.error("Error fetching feedback:", error);
        res.status(500).json({ message: "Failed to fetch feedback" });
      }
    });

    // --------------------------------------------PATCH------------------------------

    // participant profile update method
    app.patch("/users/participants-profile", verifyToken, async (req, res) => {
      try {
        const result = await UsersCollection.updateOne(
          { email: req.decoded.email },
          { $set: req.body }
        );
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // patch method for updating camp data
    app.patch("/camps/:id", async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      try {
        const result = await CampsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );

        res.send(result);
      } catch (error) {
        console.error("Error updating camp:", error);
        res.status(500).json({ message: "Failed to update camp" });
      }
    });

    // PATCH: Increment participant count
    app.patch("/camps/:id/increment-participants", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await CampsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { participantCount: 1 } } // ✅ increment by 1
        );

        res.send(result);
      } catch (error) {
        console.error("Error incrementing participant count:", error);
        res
          .status(500)
          .send({ success: false, error: "Internal server error" });
      }
    });

    // update payment status to paid
    app.patch("/update-payment-status/:campId", async (req, res) => {
      const campId = req.params.campId;
      // console.log("Camp id: ", campId);
      const paymentDetails = req.body;
      // console.log("Payment details: ", paymentDetails);

      try {
        const result = await registeredParticipantsCollection.updateOne(
          {
            campId: campId,
            participantEmail: paymentDetails?.participantEmail,
          },
          {
            $set: {
              paymentStatus: "paid",
              transactionId: paymentDetails?.transactionId,
            },
          }
        );

        res.send(result); // Send it back
      } catch (error) {
        console.error("Error updating payment status:", error);
        res.status(500).json({ error: "Failed to update payment status." });
      }
    });

    // update registered conformation from admin
    app.patch("/confirm-participant/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await registeredParticipantsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              confirmationStatus: "confirmed",
            },
          }
        );

        if (result.modifiedCount > 0) {
          res.send({ message: "Participant confirmed", result });
        } else {
          res
            .status(404)
            .send({ message: "Participant not found or already confirmed" });
        }
      } catch (error) {
        console.error("Error confirming participant:", error);
        res.status(500).send({ error: "Failed to confirm participant" });
      }
    });

    // --------------------------------------------DELETE------------------------------

    // delete method for camps
    app.delete("/camps/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await CampsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (error) {
        console.error("Error deleting camp:", error);
        res.status(500).json({ message: "Failed to delete camp" });
      }
    });

    // delete participant by admin
    app.delete(
      "/delete-registration/:id",
      verifyToken,
      verifyAdminRole,
      async (req, res) => {
        const id = req.params.id;

        try {
          const result = await registeredParticipantsCollection.deleteOne({
            _id: new ObjectId(id),
          });

          res.send(result);
        } catch (error) {
          console.error("Error deleting registration:", error);
          res
            .status(500)
            .json({ message: "Server error while deleting registration." });
        }
      }
    );

    app.delete("/cancel-registration-user/:id", async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: "Invalid participant ID" });
      }

      try {
        const result = await registeredParticipantsCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount > 0) {
          res.send({ message: "Registration cancelled successfully", result });
        } else {
          res
            .status(404)
            .json({ error: "Registration not found or already deleted" });
        }
      } catch (error) {
        console.error("User cancel registration error:", error);
        res.status(500).json({ error: "Failed to cancel registration" });
      }
    });
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

// Test route
app.get("/", (req, res) => {
  res.send("Server is running successfully 🚀");
});

// Start the server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
