const mongoose = require("mongoose");

const classroomSchema = new mongoose.Schema({
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
    index: true,
  },

  academicYearId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "AcademicYear",
    required: true,
    index: true,
  },

  // e.g. "JSS1A", "SS2B"
  name: {
    type: String,
    required: true,
    trim: true,
  },

  // e.g. "JSS1", "SS2" — used for promotion level matching
  level: {
    type: String,
    required: true,
    trim: true,
  },

  // Form/class teacher
  classTeacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },

  // Array of student user IDs enrolled in this class
  studentIds: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],

  capacity: {
    type: Number,
    default: 40,
  },

  isActive: {
    type: Boolean,
    default: true,
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

classroomSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// One class name per academic year per org
classroomSchema.index({ orgId: 1, academicYearId: 1, name: 1 }, { unique: true });
classroomSchema.index({ orgId: 1, level: 1 });

module.exports = mongoose.model("Classroom", classroomSchema);
