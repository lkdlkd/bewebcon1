const axios = require('axios');
const cron = require('node-cron');
const Banking = require('../../models/Bankking');
const Transaction = require('../../models/TransactionBanking');
const User = require('../../models/User');
const Promotion = require('../../models/Promotion');
const HistoryUser = require('../../models/History');

// Hàm tạo URL API tương ứng với loại ngân hàng
function getBankApiUrl(bank) {
    const { bank_name, bank_password, account_number, token } = bank;

    switch (bank_name.toLowerCase()) {
        case 'acb':
            return `https://api.web2m.com/historyapiacbv3/${bank_password}/${account_number}/${token}`;
        case 'vietcombank':
            return `https://api.web2m.com/historyapivcbv3/${bank_password}/${account_number}/${token}`;
        case 'techcombank':
            return `https://api.web2m.com/historyapitcbv3/${bank_password}/${account_number}/${token}`;
        case 'mbbank':
            return `https://api.web2m.com/historyapimbv3/${bank_password}/${account_number}/${token}`;
        case 'bidv':
            return `https://api.web2m.com/historyapibidvv3/${bank_password}/${account_number}/${token}`;
        default:
            return null;
    }
}

// Hàm trích xuất username từ mô tả kiểu "naptien username"
// function extractUsername(description) {
//     const match = description.match(/naptien\s+([a-zA-Z0-9_.]+)/i);
//     return match ? match[1] : null;
// }
const Configweb = require('../../models/Configweb');

// Hàm trích xuất username từ mô tả kiểu "cuphap username"
async function extractUsername(description) {
    try {
        // Lấy giá trị cuphap từ Configweb
        const config = await Configweb.findOne();
        const cuphap = config?.cuphap || "naptien"; // Sử dụng "naptien" làm giá trị mặc định nếu không có
        console.log(`Cuphap: ${cuphap}`); // In ra giá trị cuphap để kiểm tra
        console.log(`Mô tả: ${description}`); // In ra mô tả để kiểm tra

        // Tạo regex động dựa trên giá trị cuphap, chỉ lấy từ sau cuphap không chứa ký tự đặc biệt
        const regex = new RegExp(`${cuphap}\\s+([a-zA-Z0-9_]+)`, "i");
        const match = description.match(regex);
        console.log(`Regex: ${regex}`); // In ra regex để kiểm tra
        console.log(`Match: ${match}`); // In ra kết quả match để kiểm tra

        return match ? match[1] : null;
    } catch (error) {
        console.error("Lỗi khi lấy cuphap từ Configweb:", error.message);
        return null;
    }
}
// Hàm tính tiền thưởng khuyến mãi (nếu có)
// Hàm tính tiền thưởng khuyến mãi (nếu có)
async function calculateBonus(amount) {
    const now = new Date(); // giờ local
    const nowUtc = new Date(now.toISOString()); // hoặc: new Date(Date.now())

    const promo = await Promotion.findOne({
        startTime: { $lte: nowUtc },
        endTime: { $gte: nowUtc },
    });
    if (!promo) {
        console.log("⚠️ Không có chương trình khuyến mãi");
        return 0; // Không có khuyến mãi, trả về 0
    }
    // Kiểm tra nếu số tiền nhỏ hơn minAmount
    if (amount < promo.minAmount) {
        console.log(`⚠️ Số tiền (${amount}) nhỏ hơn số tiền tối thiểu (${promo.minAmount}) để được khuyến mãi`);
        return 0; // Không áp dụng khuyến mãi
    }

    console.log(`🎉 Chương trình khuyến mãi: ${promo.name} - Tỷ lệ: ${promo.percentBonus}%`);
    const bonus = Math.floor((amount * promo.percentBonus) / 100);
    return { bonus, promo }; // Trả về tiền thưởng và tỷ lệ khuyến mãi
}

// Cron job mỗi phút
cron.schedule('*/30 * * * * *', async () => {
    console.log('⏳ Đang chạy cron job...');

    try {
        const banks = await Banking.find({ status: true }); // Chỉ lấy các ngân hàng đang hoạt động

        for (const bank of banks) {
            const apiUrl = getBankApiUrl(bank);
            if (!apiUrl) {
                console.log(`❌ Không hỗ trợ ngân hàng: ${bank.bank_name}`);
                continue;
            }

            try {
                const res = await axios.get(apiUrl);
                let { transactions } = res.data;

                if (!transactions || transactions.length === 0) {
                    console.log(`⚠️ Không có giao dịch mới cho ngân hàng: ${bank.bank_name}`);
                    continue;
                }

                // Chỉ xử lý 20 giao dịch gần nhất
                transactions = transactions.slice(0, 20);

                for (const trans of transactions) {
                    // Xử lý mọi giao dịch, không chỉ IN
                    const exists = await Transaction.findOne({ transactionID: trans.transactionID });
                    if (exists) {
                        console.log(`⚠️ Giao dịch đã tồn tại: ${trans.transactionID}`);
                        continue; // Bỏ qua nếu giao dịch đã được xử lý
                    }

                    const username = await extractUsername(trans.description);
                    let user = null;
                    let bonus = 0;
                    let totalAmount = 0;
                    let promo = null;
                    const amount = parseFloat(trans.amount); // Chuyển đổi amount từ chuỗi sang số

                    if (trans.type === 'IN' && username) {
                        // Tìm user theo username
                        user = await User.findOne({ username });

                        // Cập nhật số dư người dùng và tổng số tiền nạp
                        if (user) {
                            const tiencu = user.balance;
                            // Tính tiền thưởng khuyến mãi (nếu có)
                            const bonusResult = await calculateBonus(amount);
                            bonus = bonusResult.bonus || 0; // Lấy tiền thưởng từ kết quả, nếu không có thì mặc định là 0
                            promo = bonusResult.promo; // Assign promo here
                            totalAmount = amount + bonus;
                            console.log(bonusResult);
                            console.log(`Tính toán thành công: Amount: ${amount}, Bonus: ${bonus}, Total: ${totalAmount}`);

                            console.log(`Giao dịch: ${trans.transactionID}, Amount: ${amount}, Bonus: ${bonus}, Total: ${totalAmount}`);

                            // Cập nhật số dư người dùng
                            user.balance += totalAmount;

                            // Cập nhật tổng số tiền nạp
                            user.tongnap = (user.tongnap || 0) + totalAmount;
                            user.tongnapthang = (user.tongnapthang || 0) + totalAmount;

                            // Lưu lịch sử giao dịch
                            const historyData = new HistoryUser({
                                username,
                                madon: "null",
                                hanhdong: "Cộng tiền",
                                link: "",
                                tienhientai: tiencu,
                                tongtien: totalAmount,
                                tienconlai: user.balance,
                                createdAt: new Date(),
                                mota: bonus > 0
                                    ? `Hệ thống ${bank.bank_name} tự động cộng thành công số tiền ${totalAmount} và áp dụng khuyến mãi ${promo.percentBonus}%`
                                    : `Hệ thống ${bank.bank_name} tự động cộng thành công số tiền ${totalAmount}`,
                            });
                            await historyData.save();
                            await user.save();
                            // **Thông báo qua Telegram**
                            const taoluc = new Date();
                            const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
                            const telegramChatId = process.env.TELEGRAM_CHAT_ID;

                            if (telegramBotToken && telegramChatId) {
                                const telegramMessage =
                                    `📌 *NẠP TIỀN THÀNH CÔNG!*\n\n` +
                                    `📌 *Trans_id : * ${trans.transactionID || "khong co"}\n` +
                                    `👤 *Khách hàng:* ${username}\n` +
                                    `💰 *Số tiền nạp:* ${amount}\n` +
                                    `🎁 *Khuyến mãi:* ${bonus}\n` +
                                    `🔹 *Tổng cộng:* ${totalAmount}\n` +
                                    `⏰ *Thời gian:* ${taoluc.toLocaleString()}\n`;
                                try {
                                    await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                                        chat_id: telegramChatId,
                                        text: telegramMessage,
                                        parse_mode: "Markdown",
                                    });
                                    console.log("Thông báo Telegram đã được gửi.");
                                } catch (telegramError) {
                                    console.error("Lỗi gửi thông báo Telegram:", telegramError.message);
                                }
                            }
                        } else {
                            console.log(`⚠️ Không tìm thấy user: ${username}`);
                        }
                    } else if (trans.type !== 'IN') {
                        // Nếu là OUT hoặc loại khác, chỉ lưu giao dịch, không cộng tiền
                        if (!username) {
                            console.log(`⚠️ Không tìm thấy username trong mô tả: ${trans.description}`);
                        }
                    }
                    datetime = new Date().toISOString(); // Lấy thời gian hiện tại
                    // Xác định trạng thái giao dịch
                    const transactionStatus = (trans.type === 'IN' && user) ? 'COMPLETED' : 'FAILED';

                    // Lưu giao dịch vào bảng Transaction
                    await Transaction.create({
                        typeBank: bank.bank_name, // Lưu tên ngân hàng
                        transactionID: trans.transactionID,
                        username: username || "unknown", // Lưu "unknown" nếu không tìm thấy username
                        amount: trans.amount, // Lưu số tiền đã chuyển đổi
                        description: trans.description,
                        transactionDate: datetime,
                        type: trans.type,
                        status: transactionStatus, // Trạng thái giao dịch
                        note: (trans.type === 'IN' && user)
                            ? (bonus > 0
                                ? `Hệ thống ${bank.bank_name} tự động cộng thành công số tiền ${trans.amount} và áp dụng khuyến mãi ${promo?.percentBonus || 0}%`
                                : `Hệ thống ${bank.bank_name} tự động cộng thành công số tiền ${trans.amount}`)
                            : `Hệ thống ${bank.bank_name} không thể cộng tiền vì không tìm thấy người dùng hoặc không phải giao dịch nạp tiền`,
                    });

                    if (user && trans.type === 'IN') {
                        if (bonus > 0) {
                            console.log(`🎁 ${bank.bank_name.toUpperCase()}: +${amount} (+${bonus} KM) => ${username}`);
                        } else {
                            console.log(`✅ ${bank.bank_name.toUpperCase()}: +${amount} cho ${username}`);
                        }
                    } else {
                        console.log(`⚠️ Giao dịch được lưu nhưng không cộng tiền: ${trans.transactionID}`);
                    }
                }

            } catch (bankError) {
                console.error(`❌ Lỗi xử lý ${bank.bank_name}:`, bankError.message);
            }
        }

    } catch (error) {
        console.error('❌ Cron lỗi:', error.message);
    }
});
