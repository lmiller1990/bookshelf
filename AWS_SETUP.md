aws configure --profile bookimg-new-account
AWS Access Key ID [None]: *****
AWS Secret Access Key [None]: *****
Default region name [None]: ap-southeast-2
Default output format [None]: json

aws iam create-user --user-name bookimg-textract-user --profile bookimg-new-account
{
    "User": {
        "Path": "/",
        "UserName": "bookimg-textract-user",
        "UserId": "AIDAQ3KFK5KPAFC6X25WR",
        "Arn": "arn:aws:iam::058664348318:user/bookimg-textract-user",
        "CreateDate": "2025-08-30T03:36:06+00:00"
    }
}
