const nodemailer = require('nodemailer');

const createTransporter = () => {
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_PORT === '465',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }
    return null;
};

/**
 * Send password reset OTP email
 * @param {string} toEmail - recipient email address
 * @param {string} otpCode - 6-digit numeric OTP code
 */
const sendOTPEmail = async (toEmail, otpCode) => {
    const fromAddress = process.env.EMAIL_FROM || 'DrishtiScan Support <noreply@drishtiscan.gov.in>';
    const transporter = createTransporter();

    const subject = 'DrishtiScan - Password Reset Verification Code';
    const textContent = `Your password reset code for DrishtiScan is: ${otpCode}\n\nThis code is valid for 10 minutes. If you did not request this, please ignore this email.`;
    const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="color: #0f172a; margin: 0;">DrishtiScan</h2>
                <p style="color: #64748b; font-size: 13px; margin: 4px 0 0 0;">Legal Metrology Enforcement System</p>
            </div>
            <div style="padding: 20px; background-color: #f8fafc; border-radius: 6px; text-align: center;">
                <p style="color: #334155; font-size: 15px; margin-top: 0;">You requested a password reset for your officer account.</p>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #2563eb; margin: 20px 0; padding: 12px; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 6px; display: inline-block;">
                    ${otpCode}
                </div>
                <p style="color: #64748b; font-size: 13px; margin-bottom: 0;">This code will expire in <strong>10 minutes</strong>.</p>
            </div>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 24px; text-align: center;">
                If you did not request a password reset, you can safely ignore this email.
            </p>
        </div>
    `;

    // Console log for local dev & testing convenience
    console.log(`\n======================================================`);
    console.log(`[EMAIL DISPATCH] Password Reset OTP for: ${toEmail}`);
    console.log(`[EMAIL DISPATCH] Verification Code: >>> ${otpCode} <<<`);
    console.log(`======================================================\n`);

    if (transporter) {
        try {
            const info = await transporter.sendMail({
                from: fromAddress,
                to: toEmail,
                subject: subject,
                text: textContent,
                html: htmlContent
            });
            console.log(`[Nodemailer] Email sent successfully to ${toEmail}: ${info.messageId}`);
            return { success: true, messageId: info.messageId };
        } catch (error) {
            console.warn(`[Nodemailer] Failed to send email via SMTP (${error.message}). Development console code available above.`);
            return { success: false, error: error.message };
        }
    } else {
        console.log(`[Nodemailer] No external SMTP configured; using local dev console OTP.`);
        return { success: true, devMode: true };
    }
};

module.exports = {
    sendOTPEmail
};
