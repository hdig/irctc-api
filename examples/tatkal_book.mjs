// filepath: s:\github\irctc-api\examples\tatkal_book.mjs
import {IRCTC} from "irctc-api";

async function bookTatkalTicket() {
    // Create IRCTC instance with Google Cloud Vision API for faster captcha resolution if available
    const irctc = new IRCTC({
        "userID": "XXXXX", // Secret User ID
        "password": "XXXXXXXXX", // Secret Password
        // Uncomment below for Google Cloud Vision API captcha resolution
        // "gcloud": {
        //     "type": "service_account",
        //     "project_id": "your-project-id",
        //     "private_key_id": "your-private-key-id",
        //     "private_key": "your-private-key",
        //     "client_email": "your-client-email",
        //     "client_id": "your-client-id",
        //     "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        //     "token_uri": "https://oauth2.googleapis.com/token",
        //     "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
        //     "client_x509_cert_url": "your-cert-url"
        // }
    });
    
    // Define booking parameters - use wallet payment for faster processing
    const bookingParams = {
        "payment": "wallet", // Use wallet payment which is faster and more reliable
        "class": "SL", // For Tatkal: 2A | 3A | SL | CC | 2S | FC | 1A | 3E
        "quota": "TQ", // TQ for Tatkal, PT for Premium Tatkal
        "train": "12345", // 5 Digit Train Number
        "from": "NDLS", // Station code (New Delhi)
        "to": "HWH", // Station code (Howrah)
        "date": "20250510", // YYYYMMDD - future date
        "mobile": "9876543210", // 10 Digit Mobile Number
        
        // For Tatkal, limit to 2 passengers for higher success rate
        "passengers": [
            {
                "age": 35, 
                "name": "Passenger Name",
                "gender": "M"
            },
            {
                "age": 32,
                "name": "Second Passenger",
                "gender": "F"
            }
        ]
    };
    
    try {
        // STEP 1: Prepare booking data before Tatkal window opens (5-10 minutes before)
        console.log("Preparing Tatkal booking data ahead of time...");
        await prepare_tatkal_booking(bookingParams, irctc);
        
        // STEP 2: Wait until just before Tatkal window opens
        // For SL/2S/FC class (slot 2), the window opens at 11:00 AM IST
        // For 2A/3A/CC/EC class (slot 1), the window opens at 10:00 AM IST
        console.log("Waiting for Tatkal window to open...");
        // You can add a timer here or manually start the next step
        
        // STEP 3: Execute booking exactly at or slightly after Tatkal window opens
        console.log("Executing Tatkal booking...");
        const response = await irctc.book(bookingParams);
        console.log("Booking successful!");
        return response;
    } catch (error) {
        console.error("Booking failed:", error.message);
        throw error;
    }
}

// Helper function to prepare booking data (wrapper around the internal function)
async function prepare_tatkal_booking(params, irctc) {
    // Payment type must be set based on payment method
    params.payment_type = params.payment === "wallet" ? "3" : "2";
    
    console.log(`Preparing Tatkal booking for train ${params.train} from ${params.from} to ${params.to}`);
    console.log(`Class: ${params.class}, Quota: ${params.quota}, Date: ${params.date}`);
    console.log(`Number of passengers: ${params.passengers.length}`);
    
    // This calls the internal prepare_tatkal_booking function we added to the library
    // It validates and caches the booking parameters
    return irctc.prepare_tatkal_booking(params);
}

// Execute the booking process
(async () => {
    try {
        const ticket = await bookTatkalTicket();
        console.log("Ticket booked successfully!");
        console.log(ticket);
    } catch (error) {
        console.error("Error booking Tatkal ticket:", error);
    }
})();