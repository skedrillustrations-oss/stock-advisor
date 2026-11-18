// Settings you can change without touching the rest of the code.
window.APP_CONFIG = {
  // The name shown at the top of the app.
  appName: "Stock Advisor",

  // Paste your Brevo sign-up form address here (see SETUP-GUIDE.md, step 4).
  // It looks like: https://xxxxxx.sibforms.com/serve/MUIFA......
  // Leave it empty and the email box shows "Email alerts are not switched on yet".
  brevoFormUrl: "",

  // Pretend broker fee per buy or sell, in percent. Real EGX and UAE brokers charge roughly 0.15 to 0.5%.
  feePct: 0.3,

  // Rough exchange rate, used only to add Egyptian and UAE holdings together on the risk meter.
  aedToEgp: 13.3,

  // Starting pretend money.
  startWallet: { EGP: 100000, AED: 25000 }
};
