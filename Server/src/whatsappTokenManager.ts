import dotenv from "dotenv";



dotenv.config();


export const getAccessToken = async () => {
  return process.env.WHATSAPP_ACCESS_TOKEN
};

