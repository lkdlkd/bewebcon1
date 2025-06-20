const crypto = require("crypto");
const RechargeCard = require("../../models/RechangeCard");
const Transaction = require("../../models/History");
const User = require("../../models/User");
const axios = require("axios");
const FormData = require("form-data");
const cardModel = require("../../models/Card");
const ConfigCard = require("../../models/ConfigCard"); // Import mô hình ConfigCard

/**
 * Controller cập nhật trạng thái thẻ cào
 */
exports.rechargeCardStatus = async () => {
    try {
        console.log("🔄 Đang kiểm tra và cập nhật trạng thái thẻ cào...");

        // Lấy tất cả các thẻ cào có trạng thái 'pending'
        const pendingCards = await RechargeCard.find({ status: "pending" });
        if (!pendingCards.length) {
            console.log("Không có thẻ cào nào đang chờ xử lý.");
            return;
        }
        // Lấy cấu hình từ ConfigCard
        const configCard = await ConfigCard.findOne();
        if (!configCard) {
            console.error("Cấu hình thẻ nạp không tồn tại");
            return;
        }
        // Lấy cấu hình đối tác từ biến môi trường
        const partner_id = configCard.PARTNER_ID;
        const partner_key = configCard.PARTNER_KEY;
        const apiUrl = `${configCard.API_URLCARD}/chargingws/v2`;
        console.log("Cấu hình đối tác:", {
            partner_id,
            partner_key,
            apiUrl
        });
        for (const card of pendingCards) {
            try {
                // Kiểm tra nếu card không tồn tại hoặc thiếu thông tin cần thiết
                if (!card || !card.code || !card.serial) {
                    console.error(`Thẻ không hợp lệ hoặc thiếu thông tin: ${JSON.stringify(card)}`);
                    continue;
                }

                // Tạo chữ ký MD5: partner_key + card.code + card.serial
                const sign = crypto
                    .createHash("md5")
                    .update(partner_key + card.code + card.serial)
                    .digest("hex");
                const command = "check";
                // Tạo form-data để gửi đến API đối tác
                const formdata = new FormData();
                formdata.append("telco", card.type);
                formdata.append("code", card.code);
                formdata.append("serial", card.serial);
                formdata.append("amount", card.amount);
                formdata.append("request_id", card.request_id);
                formdata.append("partner_id", partner_id);
                formdata.append("sign", sign);
                formdata.append("command", command);
                // Gửi yêu cầu lên API đối tác
                const statusCard = await axios.post(apiUrl, formdata, {
                    headers: formdata.getHeaders(),
                    timeout: 15000,
                });
                console.log("Trạng thái trả về từ API đối tác:", statusCard.data);

                // Kiểm tra kết quả trả về từ API dựa trên status code
                const apiStatus = statusCard.data.status;
                const errorMessage = statusCard.data.message || "";

                if (typeof apiStatus !== "undefined") {
                    if (apiStatus === 1) {
                        // 1: Thẻ thành công đúng mệnh giá
                        const userData = await User.findOne({ username: card.username });
                        if (!userData) {
                            console.error(`Không tìm thấy người dùng: ${card.username}`);
                            continue;
                        }

                        // Lấy phí cao nhất từ bảng Card
                        const cardInfo = await cardModel.findOne({ telco: card.type }).sort({ fees: -1 });
                        if (!cardInfo) {
                            console.error(`Không tìm thấy thông tin phí cho nhà mạng: ${card.type}`);
                            continue;
                        }

                        const percent_card = Number(cardInfo.fees) || 0;
                        const chietkhau = card.amount - (card.amount * percent_card) / 100;

                        const note = `Bạn đã nạp thành công ${chietkhau.toLocaleString("vi-VN")} VNĐ từ thẻ cào. Số dư tài khoản của bạn là ${(userData.balance + chietkhau).toLocaleString("vi-VN")} VNĐ`;

                        // Tạo giao dịch mới (HistoryUser)
                        await Transaction.create({
                            username: userData.username,
                            madon: " ",
                            hanhdong: "nạp tiền thẻ cào",
                            tongtien: chietkhau,
                            tienhientai: userData.balance,
                            tienconlai: userData.balance + chietkhau,
                            mota: note,
                        });

                        // Cập nhật thẻ cào và số dư của người dùng
                        card.real_amount = chietkhau;
                        card.status = "success";
                        await card.save();

                        userData.balance += chietkhau;
                        userData.tongnapthang = (userData.tongnapthang || 0) + chietkhau;
                        userData.tongnap = (userData.tongnap || 0) + chietkhau;
                        await userData.save();

                        // Gửi thông báo Telegram nếu có cấu hình
                        const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
                        const telegramChatId = process.env.TELEGRAM_CHAT_ID;
                        if (telegramBotToken && telegramChatId) {
                            const telegramMessage =
                                `📌 *NẠP TIỀN!*\n\n` +
                                `👤 *Khách hàng:* ${card.username}\n` +
                                `👤 *Cộng tiền:* nạp thẻ thành công số tiền ${chietkhau}.\n` +
                                `🔹 *Tạo lúc:* ${new Date().toLocaleString()}\n`;
                            try {
                                await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                                    chat_id: telegramChatId,
                                    text: telegramMessage,
                                });
                                console.log('Thông báo Telegram đã được gửi.');
                            } catch (telegramError) {
                                console.error('Lỗi gửi thông báo Telegram:', telegramError.message);
                            }
                        }
                    } else if (apiStatus === 2) {
                        // 2: Thẻ thành công sai mệnh giá
                        const userData = await User.findOne({ username: card.username });
                        if (!userData) {
                            console.error(`Không tìm thấy người dùng: ${card.username}`);
                            continue;
                        }

                        // Lấy phí cao nhất từ bảng Card
                        const cardInfo = await cardModel.findOne({ telco: card.type }).sort({ fees: -1 });
                        const percent_card = cardInfo ? Number(cardInfo.fees) : 0;

                        // Tính chiết khấu cho trường hợp sai mệnh giá
                        const chietkhau2 = (statusCard.data.value - (statusCard.data.value * percent_card / 100)) * 0.5;

                        const note = `Thẻ cào thành công nhưng sai mệnh giá. Chỉ nhận ${chietkhau2.toLocaleString("vi-VN")} VNĐ.`;

                        await Transaction.create({
                            username: userData.username,
                            madon: " ",
                            hanhdong: "nạp tiền thẻ cào - sai mệnh giá",
                            tongtien: chietkhau2,
                            tienhientai: userData.balance,
                            tienconlai: userData.balance + chietkhau2,
                            mota: note,
                        });

                        card.real_amount = chietkhau2;
                        card.status = "warning";
                        await card.save();

                        userData.balance += chietkhau2;
                        userData.tongnapthang = (userData.tongnapthang || 0) + chietkhau2;
                        userData.tongnap = (userData.tongnap || 0) + chietkhau2;
                        await userData.save();

                        // Gửi thông báo Telegram nếu có cấu hình
                        const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
                        const telegramChatId = process.env.TELEGRAM_CHAT_ID;
                        if (telegramBotToken && telegramChatId) {
                            const telegramMessage = `📌 *Cộng tiền!*\n\n` +
                                `👤 *Khách hàng:* ${card.username}\n` +
                                `👤 *Cộng tiền:*  nạp thẻ thành công số tiền  ${chietkhau2} và sai mệnh giá.\n` +
                                `🔹 *Tạo lúc:* ${new Date().toLocaleString()}\n`;
                            try {
                                await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                                    chat_id: telegramChatId,
                                    text: telegramMessage,
                                });
                                console.log('Thông báo Telegram đã được gửi.');
                            } catch (telegramError) {
                                console.error('Lỗi gửi thông báo Telegram:', telegramError.message);
                            }
                        }
                    } else if (apiStatus === 3 || apiStatus === 101) {
                        // 3: Thẻ lỗi
                        card.status = "failed";
                        card.real_amount = 0;
                        await card.save();
                    } else if (apiStatus === 4) {
                        // 4: Hệ thống bảo trì
                        card.status = "maintenance";
                        await card.save();
                    } else if (apiStatus === 99) {
                        // 99: Thẻ chờ xử lý - giữ nguyên trạng thái pending
                        console.log(`Thẻ ${card.code} đang chờ xử lý.`);
                    } else if (apiStatus === 100) {
                        // 100: Gửi thẻ thất bại - có lý do đi kèm
                        card.status = "failed";
                        card.real_amount = 0;
                        card.mota = `Gửi thẻ thất bại: ${errorMessage}`;
                        await card.save();
                    } else {
                        card.status = "failed";
                        card.real_amount = 0;
                        card.mota = `Gửi thẻ thất bại: ${errorMessage}`;
                        await card.save();
                    }
                }
            } catch (err) {
                console.error(`Lỗi xử lý thẻ ${card.code}:`, err.message);
            }
        }

        console.log("✅ Cập nhật trạng thái thẻ cào hoàn tất");
    } catch (error) {
        console.error("⚠ Lỗi cập nhật trạng thái thẻ cào:", error.message);
    }
};

// Cron job: kiểm tra trạng thái thẻ cào mỗi 30 giây
setInterval(async () => {
    console.log("⏳ Chạy cron job kiểm tra thẻ cào...");
    try {
        await exports.rechargeCardStatus();
    } catch (error) {
        console.error("Lỗi khi chạy rechargeCardStatus:", error);
    }
}, 30000); // 30,000 milliseconds = 30 secondss
