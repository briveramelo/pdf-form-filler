const { PDFDocument } = require('pdf-lib');
const express = require('express');
const { Storage } = require('@google-cloud/storage');
const dotenv = require('dotenv');
const stream = require('stream');

// Load environment variables
dotenv.config();
const envVars = {
    ...dotenv.config().parsed,
    ...process.env
};

const app = express();
app.use(express.json());  // Middleware for parsing JSON bodies

// Initialize Google Cloud Storage client
const storage = new Storage({
    projectId: envVars['GOOGLE_PROJECT_ID']
});
const bucketName = envVars['GCS_BUCKET'];

function validateFields(allowedValues, req) {
    const invalidFields = [];

    // Check each field and collect invalid ones
    for (const [field, allowedSet] of Object.entries(allowedValues)) {
        if (!req.body.hasOwnProperty(field)) {
            continue;
        }
        if (allowedSet.includes(req.body[field])) {
            continue;
        }
        invalidFields.push({
            field,
            value: req.body[field],
            allowed: allowedSet,
        });
    }

    // return invalidFields if any
    if (invalidFields.length > 0) {
        return invalidFields;
    }
}

function get_and_validate(){
    return async function (req, res, next) {
        const validationFileName = envVars['TEMPLATE_VALIDATION_FIELDS_FILE_NAME'];
        const validationFileBuffer = await downloadFileFromGcs(bucketName, validationFileName);
        const validationString = validationFileBuffer.toString('utf8');
        const validationJson = JSON.parse(validationString);
        const invalidFields = validateFields(validationJson, req);
        if (invalidFields){
            return res.status(400).json({
                error: 'Invalid values found',
                invalidFields
            });
        }
        next(); // Proceed if all validations pass
    }
}

// Helper function to download PDF from Google Cloud Storage
async function downloadFileFromGcs(bucketName, fileName) {
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(fileName);

    const fileStream = new stream.PassThrough();
    await file.createReadStream().pipe(fileStream);

    return new Promise((resolve, reject) => {
        const chunks = [];
        fileStream.on('data', (chunk) => chunks.push(chunk));
        fileStream.on('end', () => resolve(Buffer.concat(chunks)));
        fileStream.on('error', (err) => reject(err));
    });
}

app.post('/fill_pdf', get_and_validate(), async (req, res) => {
    let formData = req.body;

    // Download the PDF template and validation fields from GCS
    let inputPdfBuffer;
    try {
        const templatePdfName = envVars['TEMPLATE_PDF_FILE_NAME'];
        inputPdfBuffer = await downloadFileFromGcs(bucketName, templatePdfName);
    } catch (error) {
        return res.status(500).send('Error while downloading pdf template');
    }

    // Fill PDF form
    try {
        const outputPdfBuffer = await fillPdfForm(inputPdfBuffer, formData);
        res.setHeader('Content-Type', 'application/pdf');
        res.end(outputPdfBuffer ,'binary');
    } catch (error) {
        console.error(error);
        res.status(500).send('Error while filling pdf');
    }
});

async function fillPdfForm(templateBuffer, fieldValues) {
    // const templatePdfBuffer = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(templateBuffer);
    const form = pdfDoc.getForm();

    // Iterate over field values
    for (const [fieldName, value] of Object.entries(fieldValues)) {
        if (value === "" || value === null){
            continue;
        }

        try {
            const isRadioButton = (field) => {return form.getField(field).constructor.name === 'PDFRadioGroup';};

            if (isRadioButton(fieldName)) {
                form.getRadioGroup(fieldName).select(value);
            } else {
                form.getTextField(fieldName).setText(value);
            }
        } catch (error) {
            console.error(`Could not find field "${fieldName}": ${error.message}`);
        }
    }

    // const pdfBytesOutput = await pdfDoc.save();
    return await pdfDoc.save();
    // fs.writeFileSync(outputPath, pdfBytesOutput);
    // return pdfBytesOutput
}

const PORT = envVars.HOSTPORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// const fields = {
//     "insurance_type": "Champva",
//     "lab": "NO",
//     "tax_id_type": "SSN",
//     "assignment": "YES",
//     "pt_sex": "M",
//
//     "insurance_name": "Insurance Name",
// }
// const templatePath = "./CMS1500_radios.pdf"
// const fs = require('fs')
// const templatePdfBuffer = fs.readFileSync(templatePath);
// fillPdfForm(templatePdfBuffer, fields).then(result=>{
//     fs.writeFileSync('./example.pdf', result);
// }).catch(err=>console.error(err));

