const mongoose = require("mongoose");
const GradeBook = require("./models/GradeBook");
const dotenv = require("dotenv");
dotenv.config({ path: "./.env" });

async function run() {
  const uri = process.env.MONGODB_B2B_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/Vayrex-b2b";
  console.log("Connecting to:", uri);
  await mongoose.connect(uri);
  
  const grades = await GradeBook.find();
  console.log("Found grades to recompute:", grades.length);
  
  let count = 0;
  for (const grade of grades) {
    if (grade.status === "published") {
      // Temporary revert to draft, save to trigger pre-save, then set back to published
      grade.status = "draft";
      await grade.save();
      grade.status = "published";
      await grade.save();
    } else {
      await grade.save();
    }
    count++;
  }
  
  console.log("Successfully recomputed calculations for", count, "grades.");
  process.exit(0);
}

run().catch(console.error);
