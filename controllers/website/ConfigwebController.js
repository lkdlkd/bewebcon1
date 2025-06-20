const Configweb = require("../../models/Configweb");

// Lấy thông tin cấu hình website
exports.getConfigweb = async (req, res) => {
  try {
    let config = await Configweb.findOne();

    // Nếu chưa có cấu hình, tạo một cấu hình mặc định
    if (!config) {
      config = new Configweb({
        tieude: "",
        logo: "",
        favicon: "",
        title: "",
        lienhe: [
          {
            type: "",
            value: "",
            logolienhe: "",
          },
          {
            type: "",
            value: "",
            logolienhe: "",
          },
        ],
        cuphap: "naptien", // Thêm giá trị mặc định cho cuphap
      });
      await config.save();
    }

    res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error("Lỗi khi lấy cấu hình website:", error);
    res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};

// Cập nhật cấu hình website
exports.updateConfigweb = async (req, res) => {
  try {
    const { tieude, title, logo, favicon, lienhe, cuphap } = req.body;

    // Tìm cấu hình hiện tại
    const config = await Configweb.findOne();

    if (!config) {
      return res.status(404).json({ success: false, message: "Cấu hình website không tồn tại" });
    }

    // Kiểm tra và parse dữ liệu lienhe
    if (lienhe && !Array.isArray(lienhe)) {
      return res.status(400).json({ success: false, message: "Dữ liệu lienhe phải là một mảng" });
    }

    // Cập nhật cấu hình
    config.tieude = tieude !== undefined ? tieude : "";
    config.title = title !== undefined ? title : "";
    config.logo = logo !== undefined ? logo : "";
    config.favicon = favicon !== undefined ? favicon : "";
    config.lienhe = lienhe !== undefined ? lienhe : [];
    config.cuphap = cuphap !== undefined && cuphap.trim() !== "" ? cuphap : config.cuphap || "naptien"; // Kiểm tra giá trị trống cho cuphap
    
    await config.save();

    res.status(200).json({ success: true, message: "Cấu hình website được cập nhật thành công", data: config });
  } catch (error) {
    console.error("Lỗi khi cập nhật cấu hình website:", error);
    res.status(500).json({ success: false, message: "Lỗi server", error: error.message });
  }
};